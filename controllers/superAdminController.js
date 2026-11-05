import pool from "../config/db.js";

// ======================================
// SUPER ADMIN DASHBOARD STATISTICS
// GET /api/super-admin/dashboard
// ======================================

export const getSuperAdminDashboard = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::INTEGER
         FROM users
         WHERE role = 'owner') AS total_merchants,

        (SELECT COUNT(*)::INTEGER
         FROM stores) AS total_stores,

        (SELECT COUNT(*)::INTEGER
         FROM stores
         WHERE status = 'connected') AS connected_stores,

        (SELECT COUNT(*)::INTEGER
         FROM orders) AS total_orders,

        (SELECT COUNT(*)::INTEGER
         FROM tickets) AS total_tickets,

        (SELECT COUNT(*)::INTEGER
         FROM tickets
         WHERE status = 'open') AS open_tickets,

        (SELECT COUNT(*)::INTEGER
         FROM returns) AS total_returns,

        (SELECT COUNT(*)::INTEGER
         FROM returns
         WHERE status = 'pending') AS pending_returns
    `);

    return res.status(200).json({
      success: true,
      message: "Super Admin dashboard fetched successfully",
      stats: result.rows[0],
    });
  } catch (error) {
    console.error("Super Admin dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch Super Admin dashboard",
    });
  }
};

// ======================================
// GET ALL MERCHANTS
// GET /api/super-admin/merchants
// ======================================

export const getSuperAdminMerchants = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.created_at,

        (
          SELECT COUNT(*)::INTEGER
          FROM stores s
          WHERE s.user_id = u.id
        ) AS total_stores,

        (
          SELECT COUNT(*)::INTEGER
          FROM orders o
          WHERE o.user_id = u.id
        ) AS total_orders,

        (
          SELECT COUNT(*)::INTEGER
          FROM tickets t
          WHERE t.user_id = u.id
        ) AS total_tickets

      FROM users u
      WHERE u.role = 'owner'
      ORDER BY u.created_at DESC, u.id DESC
    `);

    return res.status(200).json({
      success: true,
      message: "Merchants fetched successfully",
      total: result.rows.length,
      merchants: result.rows,
    });
  } catch (error) {
    console.error("Super Admin merchants error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch merchants",
    });
  }
};

// ======================================
// GET ALL STORES
// GET /api/super-admin/stores
// ======================================

export const getSuperAdminStores = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.id,
        s.user_id,
        s.store_name,
        s.status,
        s.created_at,

        u.name AS merchant_name,
        u.email AS merchant_email

      FROM stores s

      INNER JOIN users u
        ON u.id = s.user_id

      ORDER BY s.created_at DESC, s.id DESC
    `);

    return res.status(200).json({
      success: true,
      message: "Stores fetched successfully",
      total: result.rows.length,
      stores: result.rows,
    });
  } catch (error) {
    console.error("Super Admin stores error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch stores",
    });
  }
};
