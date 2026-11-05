import pool from "../config/db.js";

// ==========================================
// HELPERS
// ==========================================

const handleError = (res, error, message) => {
  console.error(message, error);

  return res.status(500).json({
    success: false,
    message,
  });
};

// ==========================================
// ALLOWED SETTINGS & VALIDATION
// ==========================================

const validators = {
  platform_name: (value) =>
    typeof value === "string" &&
    value.trim().length >= 2 &&
    value.trim().length <= 150,

  support_email: (value) =>
    typeof value === "string" &&
    (value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),

  company_name: (value) =>
    typeof value === "string" &&
    value.trim().length >= 2 &&
    value.trim().length <= 150,

  timezone: (value) => {
    if (typeof value !== "string") return false;

    try {
      new Intl.DateTimeFormat("en-US", {
        timeZone: value,
      });

      return true;
    } catch {
      return false;
    }
  },

  maintenance_mode: (value) => typeof value === "boolean",

  smtp_host: (value) => typeof value === "string" && value.length <= 255,

  smtp_port: (value) => Number.isInteger(value) && value >= 1 && value <= 65535,

  smtp_username: (value) => typeof value === "string" && value.length <= 255,

  smtp_secure: (value) => typeof value === "boolean",

  default_currency: (value) =>
    typeof value === "string" && /^[A-Z]{3}$/.test(value),

  trial_days: (value) => Number.isInteger(value) && value >= 0 && value <= 365,

  ai_provider: (value) => typeof value === "string" && value.length <= 100,

  ai_model: (value) => typeof value === "string" && value.length <= 150,

  ai_enabled: (value) => typeof value === "boolean",
};

// ==========================================
// FORMAT SETTINGS
// ==========================================

const formatSettings = (rows) => {
  const settings = {};

  for (const row of rows) {
    if (!settings[row.category]) {
      settings[row.category] = {};
    }

    settings[row.category][row.settingKey] = row.settingValue;
  }

  return settings;
};

// ==========================================
// GET SUPERADMIN SETTINGS
// GET /api/super-admin/settings
// ==========================================

export const getSuperAdminSettings = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        category,
        setting_key AS "settingKey",
        setting_value AS "settingValue",
        description,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM platform_settings
      ORDER BY category, setting_key
    `);

    return res.status(200).json({
      success: true,
      message: "Settings fetched successfully",
      settings: formatSettings(result.rows),
    });
  } catch (error) {
    return handleError(res, error, "Failed to fetch settings");
  }
};

// ==========================================
// UPDATE SUPERADMIN SETTINGS
// PUT /api/super-admin/settings
// ==========================================

export const updateSuperAdminSettings = async (req, res) => {
  const body = req.body;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !body.settings ||
    typeof body.settings !== "object" ||
    Array.isArray(body.settings)
  ) {
    return res.status(400).json({
      success: false,
      message: "Valid settings object is required",
    });
  }

  const updates = Object.entries(body.settings);

  if (updates.length === 0) {
    return res.status(400).json({
      success: false,
      message: "At least one setting is required",
    });
  }

  // Validate all settings before updating anything.
  for (const [key, value] of updates) {
    if (!Object.prototype.hasOwnProperty.call(validators, key)) {
      return res.status(400).json({
        success: false,
        message: `Invalid setting key: ${key}`,
      });
    }

    if (!validators[key](value)) {
      return res.status(400).json({
        success: false,
        message: `Invalid value for setting: ${key}`,
      });
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the requested rows and ensure every key exists.
    const keys = updates.map(([key]) => key);

    const existing = await client.query(
      `
      SELECT setting_key
      FROM platform_settings
      WHERE setting_key = ANY($1::text[])
      FOR UPDATE
      `,
      [keys],
    );

    const existingKeys = new Set(existing.rows.map((row) => row.setting_key));

    const missingKey = keys.find((key) => !existingKeys.has(key));

    if (missingKey) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: `Setting not found: ${missingKey}`,
      });
    }

    for (const [key, value] of updates) {
      await client.query(
        `
        UPDATE platform_settings
        SET
          setting_value = $1::jsonb,
          updated_at = NOW()
        WHERE setting_key = $2
        `,
        [JSON.stringify(value), key],
      );
    }

    await client.query("COMMIT");

    const result = await client.query(`
      SELECT
        category,
        setting_key AS "settingKey",
        setting_value AS "settingValue"
      FROM platform_settings
      ORDER BY category, setting_key
    `);

    return res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      settings: formatSettings(result.rows),
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Settings rollback failed:", rollbackError);
    }

    return handleError(res, error, "Failed to update settings");
  } finally {
    client.release();
  }
};
