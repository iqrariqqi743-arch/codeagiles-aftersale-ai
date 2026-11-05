import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import pool from "../config/db.js";

// ==========================================
// CONFIGURATION
// ==========================================

const RESET_TOKEN_EXPIRY_MINUTES = 15;

const createToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    },
  );
};

const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const normalizeEmail = (email) => {
  return email.trim().toLowerCase();
};

const hashResetToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

const createMailTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
};

const sendPasswordResetEmail = async ({ email, name, resetUrl }) => {
  const transporter = createMailTransporter();

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Reset your CodeAgiles AfterSale AI password",
    text: `Hello ${name},

We received a request to reset your password.

Open this link to set a new password:
${resetUrl}

This link expires in ${RESET_TOKEN_EXPIRY_MINUTES} minutes.

If you did not request a password reset, you can ignore this email.

CodeAgiles AfterSale AI`,
  });
};

// ==========================================
// REGISTER
// ==========================================

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      !name.trim() ||
      !email.trim() ||
      password.length < 8
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Valid name, email and password (minimum 8 characters) are required",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users (name, email, password)
      VALUES ($1, $2, $3)
      RETURNING id, name, email, role, created_at
      `,
      [name.trim(), normalizedEmail, hashedPassword],
    );

    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      user,
      token: createToken(user),
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Email already registered",
      });
    }

    console.error("Register error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Registration failed",
    });
  }
};

// ==========================================
// LOGIN
// ==========================================

export const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const result = await pool.query(
      `
      SELECT id, name, email, password, role, created_at
      FROM users
      WHERE LOWER(email) = $1
      `,
      [normalizedEmail],
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const { password: _hashedPassword, ...safeUser } = user;

    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: safeUser,
      token: createToken(user),
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
};

// ==========================================
// GET PROFILE
// ==========================================

export const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, name, email, role, created_at
      FROM users
      WHERE id = $1
      `,
      [req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Profile error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
    });
  }
};

// ==========================================
// UPDATE PROFILE
// ==========================================

export const updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body || {};

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      !name.trim() ||
      !email.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid name and email are required",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        name = $1,
        email = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING
        id, name, email, role, created_at, updated_at
      `,
      [name.trim(), normalizedEmail, req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Email already registered",
      });
    }

    console.error("Update profile error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
};

// ==========================================
// CHANGE PASSWORD
// ==========================================

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      newPassword.length < 8
    ) {
      return res.status(400).json({
        success: false,
        message: "New password must contain at least 8 characters",
      });
    }

    const result = await pool.query(
      `
      SELECT password
      FROM users
      WHERE id = $1
      `,
      [req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const isValid = await bcrypt.compare(
      currentPassword,
      result.rows[0].password,
    );

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await pool.query(
      `
      UPDATE users
      SET
        password = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [hashedPassword, req.user.id],
    );

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to change password",
    });
  }
};

// ==========================================
// FORGOT PASSWORD
// ==========================================

export const forgotPassword = async (req, res) => {
  const genericMessage =
    "If an account exists with this email, a password reset link will be sent.";

  try {
    const { email } = req.body || {};

    if (typeof email !== "string" || !isValidEmail(normalizeEmail(email))) {
      return res.status(400).json({
        success: false,
        message: "Valid email address is required",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const result = await pool.query(
      `
      SELECT id, name, email
      FROM users
      WHERE LOWER(email) = $1
      `,
      [normalizedEmail],
    );

    const user = result.rows[0];

    // Do not disclose whether an account exists.
    if (!user) {
      return res.status(200).json({
        success: true,
        message: genericMessage,
      });
    }

    // Generate a secure random token.
    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(resetToken);

    // Replace any previous reset token for this user.
    await pool.query(
      `
      DELETE FROM password_reset_tokens
      WHERE user_id = $1
      `,
      [user.id],
    );

    await pool.query(
      `
      INSERT INTO password_reset_tokens (
        user_id,
        token_hash,
        expires_at
      )
      VALUES (
        $1,
        $2,
        NOW() + INTERVAL '15 minutes'
      )
      `,
      [user.id, tokenHash],
    );

    if (!process.env.FRONTEND_URL) {
      throw new Error("FRONTEND_URL is not configured");
    }

    const resetUrl = new URL("/reset-password", process.env.FRONTEND_URL);

    resetUrl.searchParams.set("token", resetToken);

    await sendPasswordResetEmail({
      email: user.email,
      name: user.name,
      resetUrl: resetUrl.toString(),
    });

    return res.status(200).json({
      success: true,
      message: genericMessage,
    });
  } catch (error) {
    console.error("Forgot password error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to process password reset request",
    });
  }
};

// ==========================================
// RESET PASSWORD
// ==========================================

export const resetPassword = async (req, res) => {
  const client = await pool.connect();

  try {
    const { token, newPassword } = req.body || {};

    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/i.test(token) ||
      typeof newPassword !== "string" ||
      newPassword.length < 8
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid reset token and password are required",
      });
    }

    const tokenHash = hashResetToken(token);

    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT id, user_id
      FROM password_reset_tokens
      WHERE token_hash = $1
        AND expires_at > NOW()
      FOR UPDATE
      `,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Reset link is invalid or has expired",
      });
    }

    const resetRecord = result.rows[0];

    const userResult = await client.query(
      `
      SELECT password
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [resetRecord.user_id],
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Reset link is invalid or has expired",
      });
    }

    const samePassword = await bcrypt.compare(
      newPassword,
      userResult.rows[0].password,
    );

    if (samePassword) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "New password must be different from old password",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await client.query(
      `
      UPDATE users
      SET
        password = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [hashedPassword, resetRecord.user_id],
    );

    // Invalidate all outstanding reset links.
    await client.query(
      `
      DELETE FROM password_reset_tokens
      WHERE user_id = $1
      `,
      [resetRecord.user_id],
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Password reset successfully. Please login.",
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Reset password error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to reset password",
    });
  } finally {
    client.release();
  }
};
