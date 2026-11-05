import pool from "./db.js";

export async function initializeSubscriptionSchema() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Subscription plans
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(50) NOT NULL UNIQUE,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        currency VARCHAR(3) NOT NULL DEFAULT 'USD',
        billing_interval VARCHAR(20) NOT NULL DEFAULT 'month',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. User subscriptions
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL
          REFERENCES users(id) ON DELETE RESTRICT,
        plan_id INTEGER NOT NULL
          REFERENCES subscription_plans(id),
        gateway VARCHAR(30) NOT NULL,
        gateway_customer_id TEXT,
        gateway_subscription_id TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        subscriptions_gateway_id_unique
      ON subscriptions(gateway, gateway_subscription_id)
      WHERE gateway_subscription_id IS NOT NULL;
    `);

    // 3. Payment history
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_payments (
        id BIGSERIAL PRIMARY KEY,
        subscription_id BIGINT
          REFERENCES subscriptions(id),
        gateway VARCHAR(30) NOT NULL,
        gateway_transaction_id TEXT,
        amount_cents INTEGER NOT NULL
          CHECK (amount_cents >= 0),
        currency VARCHAR(3) NOT NULL DEFAULT 'USD',
        status VARCHAR(30) NOT NULL,
        paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        subscription_payments_gateway_transaction_unique
      ON subscription_payments(gateway, gateway_transaction_id)
      WHERE gateway_transaction_id IS NOT NULL;
    `);

    // 4. Payment webhook events
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_webhook_events (
        id BIGSERIAL PRIMARY KEY,
        gateway VARCHAR(30) NOT NULL,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (gateway, event_id)
      );
    `);

    // 5. Default subscription plans
    const plans = [
      ["Starter", "starter", 2900],
      ["Growth", "growth", 4900],
      ["Pro", "pro", 11900],
    ];

    for (const [name, slug, price] of plans) {
      await client.query(
        `
        INSERT INTO subscription_plans
          (name, slug, price_cents, currency, billing_interval)
        VALUES ($1, $2, $3, 'USD', 'month')
        ON CONFLICT (slug) DO NOTHING;
        `,
        [name, slug, price],
      );
    }

    await client.query("COMMIT");

    console.log("Subscription database initialized successfully");
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Subscription database error:", error.message);

    throw error;
  } finally {
    client.release();
  }
}
