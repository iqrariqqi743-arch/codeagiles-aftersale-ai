import pool from "../config/db.js";

// ==========================================
// HELPERS
// ==========================================

const validId = (id) => /^[1-9]\d*$/.test(String(id));

const validFeatureKey = (key) =>
  typeof key === "string" && /^[a-z][a-z0-9_]{0,99}$/.test(key);

const handleError = (res, error, message) => {
  console.error(message, error);

  return res.status(500).json({
    success: false,
    message,
  });
};

// ==========================================
// GET PLAN FEATURES
// GET /api/super-admin/subscription-plans/:planId/features
// ==========================================

export const getPlanFeatures = async (req, res) => {
  try {
    const { planId } = req.params;

    if (!validId(planId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan ID",
      });
    }

    const planResult = await pool.query(
      `
      SELECT
        id,
        name,
        slug,
        price_cents AS "priceCents",
        currency,
        billing_interval AS "billingInterval",
        is_active AS "isActive"
      FROM subscription_plans
      WHERE id = $1
      `,
      [planId],
    );

    if (!planResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const featuresResult = await pool.query(
      `
      SELECT
        id,
        plan_id AS "planId",
        feature_key AS "featureKey",
        feature_name AS "featureName",
        feature_type AS "featureType",
        is_enabled AS "isEnabled",
        limit_value AS "limitValue",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM subscription_plan_features
      WHERE plan_id = $1
      ORDER BY
        CASE feature_type
          WHEN 'limit' THEN 0
          ELSE 1
        END,
        feature_name ASC
      `,
      [planId],
    );

    return res.status(200).json({
      success: true,
      message: "Subscription plan features fetched successfully",
      plan: planResult.rows[0],
      features: featuresResult.rows,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "Failed to fetch subscription plan features",
    );
  }
};

// ==========================================
// UPDATE PLAN FEATURE
// PUT /api/super-admin/subscription-plans/:planId/features/:featureKey
// ==========================================

export const updatePlanFeature = async (req, res) => {
  try {
    const { planId, featureKey } = req.params;

    if (!validId(planId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan ID",
      });
    }

    if (!validFeatureKey(featureKey)) {
      return res.status(400).json({
        success: false,
        message: "Invalid feature key",
      });
    }

    const body = req.body || {};
    const { isEnabled, limitValue } = body;

    if (
      typeof isEnabled !== "boolean" ||
      !Object.prototype.hasOwnProperty.call(body, "limitValue")
    ) {
      return res.status(400).json({
        success: false,
        message: "isEnabled (boolean) and limitValue are required",
      });
    }

    const existingResult = await pool.query(
      `
      SELECT
        id,
        feature_type,
        feature_key
      FROM subscription_plan_features
      WHERE plan_id = $1
        AND feature_key = $2
      `,
      [planId, featureKey],
    );

    if (!existingResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan feature not found",
      });
    }

    const existing = existingResult.rows[0];

    let normalizedLimit = null;

    if (existing.feature_type === "boolean") {
      if (limitValue !== null) {
        return res.status(400).json({
          success: false,
          message: "Boolean features must have a null limitValue",
        });
      }
    } else {
      if (limitValue !== null) {
        const validNumber =
          (typeof limitValue === "number" &&
            Number.isSafeInteger(limitValue)) ||
          (typeof limitValue === "string" && /^(0|[1-9]\d*)$/.test(limitValue));

        if (!validNumber) {
          return res.status(400).json({
            success: false,
            message:
              "limitValue must be a non-negative integer or null for unlimited",
          });
        }

        const parsed = Number(limitValue);

        if (!Number.isSafeInteger(parsed) || parsed < 0) {
          return res.status(400).json({
            success: false,
            message: "limitValue is outside the supported range",
          });
        }

        normalizedLimit = parsed;
      }
    }

    const result = await pool.query(
      `
      UPDATE subscription_plan_features
      SET
        is_enabled = $1,
        limit_value = $2,
        updated_at = NOW()
      WHERE plan_id = $3
        AND feature_key = $4
      RETURNING
        id,
        plan_id AS "planId",
        feature_key AS "featureKey",
        feature_name AS "featureName",
        feature_type AS "featureType",
        is_enabled AS "isEnabled",
        limit_value AS "limitValue",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [isEnabled, normalizedLimit, planId, featureKey],
    );

    return res.status(200).json({
      success: true,
      message: "Subscription plan feature updated successfully",
      feature: result.rows[0],
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "Failed to update subscription plan feature",
    );
  }
};
