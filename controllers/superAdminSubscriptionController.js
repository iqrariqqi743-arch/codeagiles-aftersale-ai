import pool from "../config/db.js";

// ==========================================
// HELPERS
// ==========================================

const validId = (id) => /^\d+$/.test(String(id)) && Number(id) > 0;

const handleError = (res, error, message) => {
  console.error(message, error);

  if (error.code === "23505") {
    return res.status(409).json({
      success: false,
      message: "Subscription plan already exists",
    });
  }

  return res.status(500).json({
    success: false,
    message,
  });
};

const formatPlan = (plan) => ({
  id: plan.id,
  name: plan.name,
  slug: plan.slug,
  price: plan.price_cents / 100,
  priceCents: plan.price_cents,
  currency: plan.currency,
  billingInterval: plan.billing_interval,
  isActive: plan.is_active,
  createdAt: plan.created_at,
});

const validatePlan = (body) => {
  const { name, slug, priceCents, currency, billingInterval } = body || {};

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof slug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !Number.isSafeInteger(priceCents) ||
    priceCents < 0 ||
    currency !== "USD" ||
    !["month", "year"].includes(billingInterval)
  ) {
    return false;
  }

  return true;
};

// ==========================================
// GET ALL SUBSCRIPTION PLANS
// GET /api/super-admin/subscription-plans
// ==========================================

export const getAllSubscriptionPlans = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        slug,
        price_cents,
        currency,
        billing_interval,
        is_active,
        created_at
      FROM subscription_plans
      ORDER BY price_cents ASC, id ASC
    `);

    return res.status(200).json({
      success: true,
      message: "Subscription plans fetched successfully",
      plans: result.rows.map(formatPlan),
    });
  } catch (error) {
    return handleError(res, error, "Failed to fetch subscription plans");
  }
};

// ==========================================
// CREATE SUBSCRIPTION PLAN
// POST /api/super-admin/subscription-plans
// ==========================================

export const createSubscriptionPlan = async (req, res) => {
  try {
    if (!validatePlan(req.body)) {
      return res.status(400).json({
        success: false,
        message:
          "Valid name, slug, priceCents, USD currency and billingInterval are required",
      });
    }

    const { name, slug, priceCents, currency, billingInterval } = req.body;

    const isActive = req.body.isActive ?? true;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean",
      });
    }

    const existing = await pool.query(
      `
      SELECT id
      FROM subscription_plans
      WHERE LOWER(slug) = LOWER($1)
      `,
      [slug],
    );

    if (existing.rows.length) {
      return res.status(409).json({
        success: false,
        message: "Plan slug already exists",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO subscription_plans
      (
        name,
        slug,
        price_cents,
        currency,
        billing_interval,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [name.trim(), slug, priceCents, currency, billingInterval, isActive],
    );

    return res.status(201).json({
      success: true,
      message: "Subscription plan created successfully",
      plan: formatPlan(result.rows[0]),
    });
  } catch (error) {
    return handleError(res, error, "Failed to create subscription plan");
  }
};

// ==========================================
// UPDATE SUBSCRIPTION PLAN
// PUT /api/super-admin/subscription-plans/:id
// ==========================================

export const updateSubscriptionPlan = async (req, res) => {
  try {
    const { id } = req.params;

    if (!validId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan ID",
      });
    }

    if (!validatePlan(req.body)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan details",
      });
    }

    const { name, slug, priceCents, currency, billingInterval } = req.body;

    const duplicate = await pool.query(
      `
      SELECT id
      FROM subscription_plans
      WHERE LOWER(slug) = LOWER($1)
        AND id <> $2
      `,
      [slug, id],
    );

    if (duplicate.rows.length) {
      return res.status(409).json({
        success: false,
        message: "Plan slug already exists",
      });
    }

    // Prevent changing billing terms of plans
    // already referenced by subscriptions.
    const existing = await pool.query(
      `
      SELECT *
      FROM subscription_plans
      WHERE id = $1
      `,
      [id],
    );

    if (!existing.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const oldPlan = existing.rows[0];

    const billingChanged =
      oldPlan.price_cents !== priceCents ||
      oldPlan.currency !== currency ||
      oldPlan.billing_interval !== billingInterval;

    if (billingChanged) {
      const usage = await pool.query(
        `
        SELECT 1
        FROM subscriptions
        WHERE plan_id = $1
        LIMIT 1
        `,
        [id],
      );

      if (usage.rows.length) {
        return res.status(409).json({
          success: false,
          message:
            "This plan has subscription history. Create a new plan version to change its billing terms.",
        });
      }
    }

    const result = await pool.query(
      `
      UPDATE subscription_plans
      SET
        name = $1,
        slug = $2,
        price_cents = $3,
        currency = $4,
        billing_interval = $5
      WHERE id = $6
      RETURNING *
      `,
      [name.trim(), slug, priceCents, currency, billingInterval, id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subscription plan updated successfully",
      plan: formatPlan(result.rows[0]),
    });
  } catch (error) {
    return handleError(res, error, "Failed to update subscription plan");
  }
};

// ==========================================
// ACTIVATE / DEACTIVATE PLAN
// PATCH /api/super-admin/subscription-plans/:id/status
// ==========================================

export const updateSubscriptionPlanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body || {};

    if (!validId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan ID",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false",
      });
    }

    const result = await pool.query(
      `
      UPDATE subscription_plans
      SET is_active = $1
      WHERE id = $2
      RETURNING *
      `,
      [isActive, id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: isActive
        ? "Subscription plan activated successfully"
        : "Subscription plan deactivated successfully",
      plan: formatPlan(result.rows[0]),
    });
  } catch (error) {
    return handleError(res, error, "Failed to update subscription plan status");
  }
};

// ==========================================
// DELETE SUBSCRIPTION PLAN
// DELETE /api/super-admin/subscription-plans/:id
// ==========================================

export const deleteSubscriptionPlan = async (req, res) => {
  try {
    const { id } = req.params;

    if (!/^[1-9]\d*$/.test(String(id))) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan ID",
      });
    }

    // Prevent deleting plans with subscription history
    const result = await pool.query(
      `
      DELETE FROM subscription_plans
      WHERE id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM subscriptions
          WHERE plan_id = $1
        )
      RETURNING id, name, slug
      `,
      [id],
    );

    if (!result.rows.length) {
      const existing = await pool.query(
        "SELECT id FROM subscription_plans WHERE id = $1",
        [id],
      );

      if (!existing.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Subscription plan not found",
        });
      }

      return res.status(409).json({
        success: false,
        message:
          "This plan has subscription history and cannot be deleted. Please deactivate it instead.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subscription plan deleted successfully",
      plan: result.rows[0],
    });
  } catch (error) {
    console.error("Delete subscription plan error:", error);

    if (error.code === "23503") {
      return res.status(409).json({
        success: false,
        message:
          "This plan has related records and cannot be deleted. Please deactivate it instead.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to delete subscription plan",
    });
  }
};
