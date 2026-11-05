import jwt from "jsonwebtoken";
import pool from "../config/db.js";

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================
export const authMiddleware = (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication token required",
    });
  }

  const token = authorization.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.id) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

// ==========================================
// SUPER ADMIN AUTHORIZATION
// ==========================================
export const superAdminMiddleware = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Verify current role from database
    const result = await pool.query(
      `
        SELECT id, role
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "User account not found",
      });
    }

    const user = result.rows[0];

    if (user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Super Admin only.",
      });
    }

    req.user = {
      ...req.user,
      id: user.id,
      role: user.role,
    };

    next();
  } catch (error) {
    console.error("Super Admin authorization error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to verify Super Admin permissions",
    });
  }
};
