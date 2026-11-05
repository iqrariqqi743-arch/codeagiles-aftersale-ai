import pool from "../config/db.js";

// GET ALL SUBSCRIPTION PLANS
export const getSubscriptionPlans = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        slug,
        price_cents,
        currency,
        billing_interval
      FROM subscription_plans
      WHERE is_active = TRUE
      ORDER BY price_cents ASC
    `);

    const plans = result.rows.map((plan) => ({
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      price: plan.price_cents / 100,
      priceCents: plan.price_cents,
      currency: plan.currency,
      billingInterval: plan.billing_interval,
    }));

    return res.status(200).json({
      success: true,
      message: "Subscription plans fetched successfully",
      plans,
    });
  } catch (error) {
    console.error("Get subscription plans error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription plans",
    });
  }
};

// GET LOGGED-IN USER SUBSCRIPTION
export const getMySubscription = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const result = await pool.query(
      `
      SELECT
        s.id,
        s.status,
        s.gateway,
        s.current_period_start,
        s.current_period_end,
        s.cancel_at_period_end,
        p.name AS plan_name,
        p.slug AS plan_slug,
        p.price_cents,
        p.currency,
        p.billing_interval
      FROM subscriptions s
      JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 1
      `,
      [userId],
    );

    if (!result.rows.length) {
      return res.status(200).json({
        success: true,
        subscription: null,
      });
    }

    const subscription = result.rows[0];

    return res.status(200).json({
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        gateway: subscription.gateway,
        plan: {
          name: subscription.plan_name,
          slug: subscription.plan_slug,
          price: subscription.price_cents / 100,
          currency: subscription.currency,
          billingInterval: subscription.billing_interval,
        },
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
  } catch (error) {
    console.error("Get subscription error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription",
    });
  }
};
