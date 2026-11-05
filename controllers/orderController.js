import pool from "../config/db.js";
import crypto from "node:crypto";
import axios from "axios";
// GET ALL ORDERS OF LOGGED-IN USER
// Also returns products/items belonging to each order.
export const getOrders = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         o.*,
         s.store_name,
         s.store_url,

         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id', oi.id,
                 'product_name', oi.product_name,
                 'product_image', oi.product_image,
                 'product_sku', oi.product_sku,
                 'quantity', oi.quantity,
                 'unit_price', oi.unit_price,
                 'color', oi.color,
                 'size', oi.size,
                 'variation', oi.variation
               )
               ORDER BY oi.id
             )
             FROM order_items oi
             WHERE oi.order_id = o.id
           ),
           '[]'::json
         ) AS items

       FROM orders o
       INNER JOIN stores s ON s.id = o.store_id

       WHERE o.user_id = $1
         AND s.user_id = $1

       ORDER BY o.order_date DESC, o.id DESC`,
      [req.user.id],
    );

    return res.json({
      success: true,
      orders: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Get orders error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    });
  }
};

// CREATE DEMO ORDERS FOR AN EXISTING STORE
export const createDemoOrders = async (req, res) => {
  const client = await pool.connect();

  try {
    const { store_id } = req.body;
    const userId = req.user.id;

    if (!store_id) {
      return res.status(400).json({
        success: false,
        message: "Store ID is required",
      });
    }

    await client.query("BEGIN");

    const storeResult = await client.query(
      `SELECT id, store_name, status
       FROM stores
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [store_id, userId],
    );

    if (!storeResult.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    const store = storeResult.rows[0];

    // Never add demo data to a connected WooCommerce store.
    if (store.status === "connected") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Demo orders cannot be added to a connected store",
      });
    }

    const demoOrders = [
      ["CA-1001", "Ali Khan", "ali@example.com", 120.0, "completed"],
      ["CA-1002", "Sara Ahmed", "sara@example.com", 85.5, "processing"],
      ["CA-1003", "Usman Malik", "usman@example.com", 230.0, "pending"],
      ["CA-1004", "Ayesha Noor", "ayesha@example.com", 49.99, "completed"],
      ["CA-1005", "Bilal Hussain", "bilal@example.com", 170.0, "on-hold"],
      ["CA-1006", "Fatima Ali", "fatima@example.com", 65.0, "refunded"],
      ["CA-1007", "Hamza Khan", "hamza@example.com", 310.0, "processing"],
      ["CA-1008", "Zara Shah", "zara@example.com", 92.0, "completed"],
      ["CA-1009", "Ahmed Raza", "ahmed@example.com", 155.75, "cancelled"],
      ["CA-1010", "Hina Malik", "hina@example.com", 210.0, "pending"],
      ["CA-1011", "Danish Ali", "danish@example.com", 78.25, "completed"],
      ["CA-1012", "Mariam Khan", "mariam@example.com", 440.0, "processing"],
    ];

    // Sample products are only for demo orders.
    // Two product prices add up to the order total.
    const demoProductCatalog = [
      {
        name: "Classic Cotton T-Shirt",
        sku: "DEMO-TSHIRT-001",
        image:
          "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=500",
        color: "Black",
        size: "M",
        variation: { material: "Cotton", fit: "Regular" },
      },
      {
        name: "Running Sneakers",
        sku: "DEMO-SHOES-002",
        image:
          "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500",
        color: "Red",
        size: "42",
        variation: { material: "Synthetic", style: "Running" },
      },
      {
        name: "Casual Backpack",
        sku: "DEMO-BAG-003",
        image:
          "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500",
        color: "Black",
        size: "Standard",
        variation: { material: "Polyester" },
      },
      {
        name: "Classic Wrist Watch",
        sku: "DEMO-WATCH-004",
        image:
          "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500",
        color: "Silver",
        size: "Standard",
        variation: { strap: "Metal", display: "Analog" },
      },
      {
        name: "Denim Jacket",
        sku: "DEMO-JACKET-005",
        image:
          "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=500",
        color: "Blue",
        size: "L",
        variation: { material: "Denim", fit: "Regular" },
      },
      {
        name: "Casual Handbag",
        sku: "DEMO-HANDBAG-006",
        image:
          "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=500",
        color: "Brown",
        size: "Standard",
        variation: { material: "Leather" },
      },
    ];

    let inserted = 0;
    let itemsInserted = 0;

    for (let i = 0; i < demoOrders.length; i++) {
      const [orderNumber, customerName, customerEmail, total, status] =
        demoOrders[i];

      // Create order if it does not already exist.
      const insertOrderResult = await client.query(
        `INSERT INTO orders (
           user_id,
           store_id,
           order_number,
           customer_name,
           customer_email,
           total_amount,
           currency,
           status,
           payment_method,
           is_demo,
           order_date
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,NOW())

         ON CONFLICT (store_id, order_number)
         DO NOTHING

         RETURNING id, is_demo`,
        [
          userId,
          store.id,
          orderNumber,
          customerName,
          customerEmail,
          total,
          "USD",
          status,
          "Demo Payment",
        ],
      );

      let order;

      if (insertOrderResult.rows.length > 0) {
        order = insertOrderResult.rows[0];
        inserted++;
      } else {
        // Fetch existing order after duplicate conflict.
        const existingOrderResult = await client.query(
          `SELECT id, is_demo
           FROM orders
           WHERE store_id = $1
             AND order_number = $2
             AND user_id = $3`,
          [store.id, orderNumber, userId],
        );

        order = existingOrderResult.rows[0];
      }

      if (!order) {
        continue;
      }

      // Never attach fake products to a real order.
      if (!order.is_demo) {
        continue;
      }

      // Check whether products already exist.
      const existingItemsResult = await client.query(
        `SELECT COUNT(*)::INTEGER AS total
         FROM order_items
         WHERE order_id = $1`,
        [order.id],
      );

      // Do not duplicate existing order items.
      if (existingItemsResult.rows[0].total > 0) {
        continue;
      }

      const firstProduct = demoProductCatalog[i % demoProductCatalog.length];

      const secondProduct =
        demoProductCatalog[(i + 1) % demoProductCatalog.length];

      const firstPrice = Number((Number(total) * 0.6).toFixed(2));
      const secondPrice = Number((Number(total) - firstPrice).toFixed(2));

      const products = [
        {
          ...firstProduct,
          quantity: 1,
          price: firstPrice,
        },
        {
          ...secondProduct,
          quantity: 1,
          price: secondPrice,
        },
      ];

      for (const product of products) {
        await client.query(
          `INSERT INTO order_items (
             order_id,
             product_name,
             product_image,
             product_sku,
             quantity,
             unit_price,
             color,
             size,
             variation
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            order.id,
            product.name,
            product.image,
            product.sku,
            product.quantity,
            product.price,
            product.color,
            product.size,
            JSON.stringify(product.variation),
          ],
        );

        itemsInserted++;
      }
    }

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: `${inserted} demo orders and ${itemsInserted} demo products added successfully`,
      inserted,
      itemsInserted,
      store_id: store.id,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Create demo orders error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to create demo orders",
    });
  } finally {
    client.release();
  }
};

// GET ENCRYPTION KEY
const getEncryptionKey = () => {
  const raw = process.env.WOO_ENCRYPTION_KEY;

  if (!raw || !/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error("WOO_ENCRYPTION_KEY must be 64 hex characters");
  }

  return Buffer.from(raw, "hex");
};

// DECRYPT WOOCOMMERCE CREDENTIALS
const decrypt = (encryptedValue) => {
  if (typeof encryptedValue !== "string") {
    throw new Error("Invalid encrypted credential");
  }

  const parts = encryptedValue.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted credential format");
  }

  const [ivHex, tagHex, encryptedHex] = parts;

  if (
    !/^[a-f0-9]{24}$/i.test(ivHex) ||
    !/^[a-f0-9]{32}$/i.test(tagHex) ||
    !/^(?:[a-f0-9]{2})+$/i.test(encryptedHex)
  ) {
    throw new Error("Invalid encrypted credential data");
  }

  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    iv,
  );

  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
};

// SYNC REAL WOOCOMMERCE ORDERS
export const syncWooCommerceOrders = async (req, res) => {
  const userId = req.user.id;
  const { store_id } = req.body;

  let client;
  let transactionStarted = false;

  try {
    if (!store_id) {
      return res.status(400).json({
        success: false,
        message: "Store ID is required",
      });
    }

    // 1. GET CONNECTED STORE
    const storeResult = await pool.query(
      `SELECT
         id,
         store_name,
         store_url,
         platform,
         status,
         woo_consumer_key,
         woo_consumer_secret
       FROM stores
       WHERE id = $1 AND user_id = $2`,
      [store_id, userId],
    );

    if (!storeResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    const store = storeResult.rows[0];

    if (store.platform !== "woocommerce" || store.status !== "connected") {
      return res.status(400).json({
        success: false,
        message: "WooCommerce store is not connected",
      });
    }

    // 2. DECRYPT API CREDENTIALS
    const consumerKey = decrypt(store.woo_consumer_key);
    const consumerSecret = decrypt(store.woo_consumer_secret);

    // 3. BUILD WOOCOMMERCE ORDERS API URL
    const storeUrl = store.store_url.replace(/\/+$/, "");

    const apiUrl = new URL("wp-json/wc/v3/orders", `${storeUrl}/`);

    if (apiUrl.protocol !== "https:") {
      return res.status(400).json({
        success: false,
        message: "WooCommerce store must use HTTPS",
      });
    }

    // 4. FETCH ORDERS FROM WOOCOMMERCE
    const wooOrders = [];

    const perPage = 100;
    const maxPages = 50;

    for (let page = 1; page <= maxPages; page++) {
      const response = await axios.get(apiUrl.toString(), {
        auth: {
          username: consumerKey,
          password: consumerSecret,
        },

        params: {
          per_page: perPage,
          page,
          orderby: "date",
          order: "desc",
        },

        headers: {
          Accept: "application/json",
        },

        timeout: 20000,
        maxRedirects: 0,
        maxContentLength: 10 * 1024 * 1024,
        proxy: false,
        validateStatus: (status) => status === 200,
      });

      if (!Array.isArray(response.data)) {
        throw new Error("Invalid WooCommerce orders response");
      }

      wooOrders.push(...response.data);

      if (response.data.length < perPage) {
        break;
      }
    }

    // 5. START DATABASE TRANSACTION
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // Lock store while importing its orders.
    const lockedStore = await client.query(
      `SELECT id
       FROM stores
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [store_id, userId],
    );

    if (!lockedStore.rows.length) {
      throw new Error("Store no longer exists");
    }

    let insertedOrders = 0;
    let updatedOrders = 0;
    let insertedItems = 0;

    // 6. SAVE ORDERS AND ORDER ITEMS
    for (const wooOrder of wooOrders) {
      if (!wooOrder.id) {
        continue;
      }

      const billing = wooOrder.billing || {};
      const shipping = wooOrder.shipping || {};

      const customerName =
        [billing.first_name, billing.last_name].filter(Boolean).join(" ") ||
        "Guest Customer";

      const orderNumber = String(wooOrder.number || wooOrder.id);

      const shippingAddress = Object.values(shipping).some(Boolean)
        ? JSON.stringify(shipping)
        : null;

      // INSERT OR UPDATE ORDER
      const orderResult = await client.query(
        `INSERT INTO orders (
           user_id,
           store_id,
           woo_order_id,
           order_number,
           customer_name,
           customer_email,
           customer_phone,
           currency,
           total_amount,
           status,
           payment_method,
           shipping_address,
           is_demo,
           order_date
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,$13
         )
         ON CONFLICT (store_id, woo_order_id)
         DO UPDATE SET
           order_number = EXCLUDED.order_number,
           customer_name = EXCLUDED.customer_name,
           customer_email = EXCLUDED.customer_email,
           customer_phone = EXCLUDED.customer_phone,
           currency = EXCLUDED.currency,
           total_amount = EXCLUDED.total_amount,
           status = EXCLUDED.status,
           payment_method = EXCLUDED.payment_method,
           shipping_address = EXCLUDED.shipping_address,
           order_date = EXCLUDED.order_date,
           updated_at = NOW()
         RETURNING id, (xmax = 0) AS inserted`,
        [
          userId,
          store_id,
          wooOrder.id,
          orderNumber,
          customerName,
          billing.email || null,
          billing.phone || null,
          wooOrder.currency || "USD",
          Number(wooOrder.total || 0),
          wooOrder.status || "pending",
          wooOrder.payment_method_title || null,
          shippingAddress,
          wooOrder.date_created || new Date().toISOString(),
        ],
      );

      const savedOrder = orderResult.rows[0];

      if (savedOrder.inserted) {
        insertedOrders++;
      } else {
        updatedOrders++;
      }

      // REMOVE OLD ITEMS BEFORE RE-IMPORTING CURRENT ITEMS.
      // This prevents duplicate items when an order is synced again.
      await client.query(
        `DELETE FROM order_items
         WHERE order_id = $1`,
        [savedOrder.id],
      );

      const lineItems = Array.isArray(wooOrder.line_items)
        ? wooOrder.line_items
        : [];

      for (const item of lineItems) {
        const quantity = Math.max(0, Number(item.quantity || 0));

        const lineTotal = Number(item.total || 0);

        const unitPrice = quantity > 0 ? lineTotal / quantity : 0;

        // Extract variation metadata.
        const metaData = {};

        for (const meta of item.meta_data || []) {
          if (meta.key) {
            metaData[meta.key] = meta.value;
          }
        }

        const getAttribute = (name) => {
          const key = Object.keys(metaData).find((itemKey) =>
            itemKey.toLowerCase().includes(name),
          );

          return key ? String(metaData[key]) : null;
        };

        const variation = {
          product_id: item.product_id || null,
          variation_id: item.variation_id || null,
          meta_data: metaData,
        };

        await client.query(
          `INSERT INTO order_items (
             order_id,
             product_name,
             product_image,
             product_sku,
             quantity,
             unit_price,
             color,
             size,
             variation
           )
           VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb
           )`,
          [
            savedOrder.id,
            item.name || "Unknown Product",
            null,
            item.sku || null,
            quantity,
            unitPrice,
            getAttribute("color"),
            getAttribute("size"),
            JSON.stringify(variation),
          ],
        );

        insertedItems++;
      }
    }

    // 7. COMMIT TRANSACTION
    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      success: true,
      message: "WooCommerce orders synced successfully",

      store: {
        id: store.id,
        name: store.store_name,
      },

      summary: {
        totalFetched: wooOrders.length,
        insertedOrders,
        updatedOrders,
        insertedItems,
      },
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
      transactionStarted = false;
    }

    console.error("WooCommerce order sync error:", {
      message: error.message,
      status: error.response?.status,
      code: error.code,
    });

    if (error.response?.status === 401 || error.response?.status === 403) {
      return res.status(400).json({
        success: false,
        message:
          "WooCommerce rejected the API credentials or order permissions.",
      });
    }

    if (error.response?.status === 404) {
      return res.status(400).json({
        success: false,
        message: "WooCommerce Orders API endpoint was not found.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to sync WooCommerce orders",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};
