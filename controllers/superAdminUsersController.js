import bcrypt from "bcryptjs";
import pool from "../config/db.js";

// ==========================================
// HELPERS
// ==========================================

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const allowedRoles = ["owner", "super_admin"];

const validId = (id) => /^\d+$/.test(String(id)) && Number(id) > 0;

const handleError = (res, error, message) => {
  console.error(message, error);

  if (error.code === "23505") {
    return res.status(409).json({
      success: false,
      message: "Email already exists.",
    });
  }

  return res.status(500).json({
    success: false,
    message,
  });
};

// ==========================================
// GET ALL USERS
// GET /api/super-admin/users
// ==========================================

export const getAllUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 10),
    );

    const offset = (page - 1) * limit;

    const search = String(req.query.search || "").trim();
    const role = String(req.query.role || "").trim();
    const status = String(req.query.status || "").trim();

    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);

      conditions.push(`
        (
          name ILIKE $${params.length}
          OR email ILIKE $${params.length}
          OR CAST(id AS TEXT) ILIKE $${params.length}
        )
      `);
    }

    if (role) {
      params.push(role);
      conditions.push(`role = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::INTEGER AS total
       FROM users
       ${whereClause}`,
      params,
    );

    const total = countResult.rows[0].total;

    const queryParams = [...params, limit, offset];

    const usersResult = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        role,
        status,
        created_at,
        updated_at
      FROM users
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      queryParams,
    );

    return res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      users: usersResult.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return handleError(res, error, "Failed to fetch users");
  }
};

// ==========================================
// GET SINGLE USER
// GET /api/super-admin/users/:id
// ==========================================

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!validId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        role,
        status,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
      `,
      [id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User fetched successfully",
      user: result.rows[0],
    });
  } catch (error) {
    return handleError(res, error, "Failed to fetch user");
  }
};

// ==========================================
// CREATE USER
// POST /api/super-admin/users
// ==========================================

export const createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !isValidEmail(email.trim()) ||
      typeof password !== "string" ||
      password.length < 8 ||
      !allowedRoles.includes(role)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Valid name, email, role and password (minimum 8 characters) are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE LOWER(email) = $1",
      [normalizedEmail],
    );

    if (existingUser.rows.length) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users
        (name, email, password, role, status, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, 'active', NOW(), NOW())
      RETURNING
        id, name, email, role, status, created_at, updated_at
      `,
      [name.trim(), normalizedEmail, hashedPassword, role],
    );

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    return handleError(res, error, "Failed to create user");
  }
};

// ==========================================
// UPDATE USER
// PUT /api/super-admin/users/:id
// ==========================================

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role } = req.body || {};

    if (!validId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    const existing = await pool.query(
      "SELECT id, role FROM users WHERE id = $1",
      [id],
    );

    if (!existing.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !isValidEmail(email.trim()) ||
      !allowedRoles.includes(role)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid name, email and role are required",
      });
    }

    if (
      password !== undefined &&
      (typeof password !== "string" ||
        (password.length > 0 && password.length < 8))
    ) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 8 characters",
      });
    }

    // Prevent changing your own Super Admin role
    if (String(req.user?.id) === String(id) && role !== existing.rows[0].role) {
      return res.status(403).json({
        success: false,
        message: "You cannot change your own role",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const duplicate = await pool.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(email) = $1 AND id <> $2
      `,
      [normalizedEmail, id],
    );

    if (duplicate.rows.length) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    let result;

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 12);

      result = await pool.query(
        `
        UPDATE users
        SET
          name = $1,
          email = $2,
          role = $3,
          password = $4,
          updated_at = NOW()
        WHERE id = $5
        RETURNING
          id, name, email, role, status, created_at, updated_at
        `,
        [name.trim(), normalizedEmail, role, hashedPassword, id],
      );
    } else {
      result = await pool.query(
        `
        UPDATE users
        SET
          name = $1,
          email = $2,
          role = $3,
          updated_at = NOW()
        WHERE id = $4
        RETURNING
          id, name, email, role, status, created_at, updated_at
        `,
        [name.trim(), normalizedEmail, role, id],
      );
    }

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      user: result.rows[0],
    });
  } catch (error) {
    return handleError(res, error, "Failed to update user");
  }
};

// ==========================================
// ACTIVATE / DEACTIVATE USER
// PATCH /api/super-admin/users/:id/status
// ==========================================

export const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!validId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be active or inactive",
      });
    }

    if (String(req.user?.id) === String(id) && status === "inactive") {
      return res.status(403).json({
        success: false,
        message: "You cannot deactivate your own account",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING
        id, name, email, role, status, created_at, updated_at
      `,
      [status, id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `User ${status === "active" ? "activated" : "deactivated"} successfully`,
      user: result.rows[0],
    });
  } catch (error) {
    return handleError(res, error, "Failed to update user status");
  }
};

// ==========================================
// DELETE USER
// DELETE /api/super-admin/users/:id
// ==========================================

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!validId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    if (String(req.user?.id) === String(id)) {
      return res.status(403).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    const result = await pool.query(
      `
      DELETE FROM users
      WHERE id = $1
      RETURNING id, name, email
      `,
      [id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
      user: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(409).json({
        success: false,
        message:
          "This user has related records and cannot be deleted directly.",
      });
    }

    return handleError(res, error, "Failed to delete user");
  }
};
