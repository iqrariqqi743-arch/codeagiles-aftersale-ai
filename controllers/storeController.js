import pool from "../config/db.js";
import axios from "axios";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";

const PUBLIC_COLUMNS = `
  id,
  user_id,
  store_name,
  store_url,
  platform,
  status,
  created_at,
  updated_at,
  connected_at
`;

// ========================================
// ENCRYPTION
// ========================================

const getEncryptionKey = () => {
  const raw = process.env.WOO_ENCRYPTION_KEY;

  if (!raw || !/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error("WOO_ENCRYPTION_KEY must be 64 hex characters");
  }

  return Buffer.from(raw, "hex");
};

const encrypt = (value) => {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
};

// ========================================
// IP VALIDATION
// ========================================

const isPrivateIPv4 = (ip) => {
  const parts = ip.split(".").map(Number);
  const [a, b, c] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a === 255
  );
};

const isPublicIP = (ip) => {
  const version = net.isIP(ip);

  if (version === 4) {
    return !isPrivateIPv4(ip);
  }

  if (version === 6) {
    const normalized = ip.toLowerCase();

    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    ) {
      return false;
    }

    if (normalized.startsWith("::ffff:")) {
      const embedded = normalized.slice(7);

      return net.isIP(embedded) === 4 && !isPrivateIPv4(embedded);
    }

    return true;
  }

  return false;
};

// ========================================
// STORE URL NORMALIZATION
// ========================================

const normalizeStoreUrl = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Store URL is required");
  }

  let url;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Invalid store URL");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    net.isIP(url.hostname) ||
    url.hostname === "localhost" ||
    !url.hostname.includes(".")
  ) {
    throw new Error(
      "Use a public HTTPS WooCommerce domain without a custom port",
    );
  }

  // IMPORTANT:
  // Preserve WPSandbox subdirectory path.
  // Example:
  // https://eu2.wpsandbox.org/site/s-q85gzbwbrhnab

  const pathname = url.pathname.replace(/\/+$/, "");

  return `${url.origin}${pathname}`;
};

// ========================================
// DNS VALIDATION
// ========================================

const resolvePublicAddresses = async (hostname) => {
  const records = await dns.lookup(hostname, {
    all: true,
  });

  if (!records.length || records.some((item) => !isPublicIP(item.address))) {
    throw new Error("Store domain resolves to a restricted address");
  }

  return records;
};

// ========================================
// HTTPS AGENT
// ========================================

const createSecureAgent = (records) => {
  const lookup = (_hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }

    const family = options?.family;

    const filtered = family
      ? records.filter((item) => item.family === family)
      : records;

    if (!filtered.length) {
      callback(new Error("No approved DNS address available"));
      return;
    }

    if (options?.all) {
      callback(null, filtered);
    } else {
      callback(null, filtered[0].address, filtered[0].family);
    }
  };

  return new https.Agent({
    lookup,
    keepAlive: true,
  });
};

// ========================================
// ADD STORE
// ========================================

export const addStore = async (req, res) => {
  try {
    const { store_name, store_url } = req.body;

    if (
      typeof store_name !== "string" ||
      !store_name.trim() ||
      store_name.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid store name is required (max 150 characters)",
      });
    }

    let normalizedUrl;

    try {
      normalizedUrl = normalizeStoreUrl(store_url);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    const result = await pool.query(
      `INSERT INTO stores
        (user_id, store_name, store_url)
       VALUES ($1, $2, $3)
       RETURNING ${PUBLIC_COLUMNS}`,
      [req.user.id, store_name.trim(), normalizedUrl],
    );

    return res.status(201).json({
      success: true,
      message: "Store added successfully",
      store: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Store already added",
      });
    }

    console.error("Add store error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to add store",
    });
  }
};

// ========================================
// GET MY STORES
// ========================================

export const getStores = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS}
       FROM stores
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id],
    );

    return res.json({
      success: true,
      stores: result.rows,
    });
  } catch (error) {
    console.error("Get stores error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch stores",
    });
  }
};

// ========================================
// CONNECT WOOCOMMERCE
// ========================================

export const connectWooCommerce = async (req, res) => {
  let agent;

  try {
    const { consumer_key, consumer_secret } = req.body;
    const { id } = req.params;

    // Validate credentials

    if (
      typeof consumer_key !== "string" ||
      typeof consumer_secret !== "string" ||
      !consumer_key.trim() ||
      !consumer_secret.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Consumer Key and Consumer Secret are required",
      });
    }

    // Get user's store

    const storeResult = await pool.query(
      `SELECT id, store_url
       FROM stores
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id],
    );

    if (!storeResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    const store = storeResult.rows[0];

    // Normalize URL

    let storeUrl;

    try {
      storeUrl = normalizeStoreUrl(store.store_url);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    // Build WooCommerce Products API URL

    const url = new URL(
      "wp-json/wc/v3/products?per_page=1",
      `${storeUrl.replace(/\/+$/, "")}/`,
    );

    // Validate domain DNS

    const records = await resolvePublicAddresses(url.hostname);

    agent = createSecureAgent(records);

    // Test WooCommerce API connection

    const response = await axios.get(url.toString(), {
      auth: {
        username: consumer_key.trim(),
        password: consumer_secret.trim(),
      },

      headers: {
        Accept: "application/json",
      },

      timeout: 15000,
      maxRedirects: 0,
      maxContentLength: 1024 * 1024,
      proxy: false,
      httpsAgent: agent,

      validateStatus: (status) => status === 200,
    });

    // Products endpoint should return an array

    if (!Array.isArray(response.data)) {
      return res.status(502).json({
        success: false,
        message: "Invalid WooCommerce Products API response",
      });
    }

    // Encrypt credentials only after successful API test

    const encryptedKey = encrypt(consumer_key.trim());

    const encryptedSecret = encrypt(consumer_secret.trim());

    // Save connection in database

    const result = await pool.query(
      `UPDATE stores
       SET woo_consumer_key = $1,
           woo_consumer_secret = $2,
           platform = 'woocommerce',
           status = 'connected',
           connected_at = NOW(),
           updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING ${PUBLIC_COLUMNS}`,
      [encryptedKey, encryptedSecret, id, req.user.id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Store no longer exists",
      });
    }

    return res.json({
      success: true,
      message: "WooCommerce connected successfully",
      store: result.rows[0],
    });
  } catch (error) {
    console.error("WooCommerce connection debug:", {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      response: error.response?.data,
      requestUrl: error.config?.url,
    });

    if (error.response?.status === 401 || error.response?.status === 403) {
      return res.status(400).json({
        success: false,
        message:
          "WooCommerce rejected the credentials or the API user does not have permission to read products.",
      });
    }

    if ([301, 302, 307, 308].includes(error.response?.status)) {
      return res.status(400).json({
        success: false,
        message:
          "Store API redirected the request. Check the final HTTPS store URL.",
      });
    }

    if (error.message?.includes("WOO_ENCRYPTION_KEY")) {
      return res.status(500).json({
        success: false,
        message: "Server encryption configuration is missing or invalid.",
      });
    }

    if (error.message?.includes("restricted address")) {
      return res.status(400).json({
        success: false,
        message: "Store domain resolves to a restricted IP address.",
      });
    }

    return res.status(400).json({
      success: false,
      message:
        "Could not verify WooCommerce connection. Check the store URL, API access, and server logs.",
    });
  } finally {
    if (agent) {
      agent.destroy();
    }
  }
};

// ========================================
// DISCONNECT WOOCOMMERCE
// ========================================

export const disconnectWooCommerce = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE stores
       SET woo_consumer_key = NULL,
           woo_consumer_secret = NULL,
           status = 'disconnected',
           connected_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING ${PUBLIC_COLUMNS}`,
      [req.params.id, req.user.id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    return res.json({
      success: true,
      message: "WooCommerce disconnected successfully",
      store: result.rows[0],
    });
  } catch (error) {
    console.error("Disconnect store error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to disconnect store",
    });
  }
};

// ========================================
// DELETE STORE
// ========================================

export const deleteStore = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM stores
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    return res.json({
      success: true,
      message: "Store deleted successfully",
    });
  } catch (error) {
    console.error("Delete store error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to delete store",
    });
  }
};
