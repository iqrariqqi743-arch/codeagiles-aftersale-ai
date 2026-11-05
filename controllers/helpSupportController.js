import pool from "../config/db.js";
import { randomBytes } from "node:crypto";

const ADMIN_ROLES = ["admin", "super_admin"];

// Helpers
const isValidId = (id) => Number.isSafeInteger(Number(id)) && Number(id) > 0;

const validCategories = [
  "general",
  "technical",
  "billing",
  "subscription",
  "account",
  "other",
];

const validPriorities = ["low", "medium", "high", "urgent"];

const validStatuses = ["open", "in_progress", "resolved", "closed"];

const generateTicketNumber = () =>
  `HELP-${randomBytes(8).toString("hex").toUpperCase()}`;

const getCurrentUser = async (userId) => {
  const result = await pool.query("SELECT id, role FROM users WHERE id = $1", [
    userId,
  ]);

  return result.rows[0] || null;
};

const isAdmin = (user) => ADMIN_ROLES.includes(user?.role);

// ==========================================
// CREATE HELP SUPPORT TICKET
// ==========================================

export const createHelpSupportTicket = async (req, res) => {
  try {
    const { subject, description, category, priority } = req.body;

    if (
      typeof subject !== "string" ||
      typeof description !== "string" ||
      !subject.trim() ||
      !description.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Subject and description are required",
      });
    }

    if (subject.trim().length > 255) {
      return res.status(400).json({
        success: false,
        message: "Subject must not exceed 255 characters",
      });
    }

    const selectedCategory = category ?? "general";
    const selectedPriority = priority ?? "medium";

    if (
      !validCategories.includes(selectedCategory) ||
      !validPriorities.includes(selectedPriority)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid category or priority",
      });
    }

    const user = await getCurrentUser(req.user.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    const ticketNumber = generateTicketNumber();

    const result = await pool.query(
      `INSERT INTO help_support_tickets
       (
         ticket_number,
         user_id,
         subject,
         description,
         category,
         priority,
         status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'open')
       RETURNING *`,
      [
        ticketNumber,
        user.id,
        subject.trim(),
        description.trim(),
        selectedCategory,
        selectedPriority,
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      ticket: result.rows[0],
    });
  } catch (error) {
    console.error("Create help ticket error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to create support ticket",
    });
  }
};

// ==========================================
// GET MY HELP SUPPORT TICKETS
// ==========================================

export const getMyHelpSupportTickets = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM help_support_tickets
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id],
    );

    return res.status(200).json({
      success: true,
      tickets: result.rows,
    });
  } catch (error) {
    console.error("Get my tickets error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch support tickets",
    });
  }
};

// ==========================================
// GET ALL HELP SUPPORT TICKETS - ADMIN
// ==========================================

export const getAllHelpSupportTickets = async (req, res) => {
  try {
    const user = await getCurrentUser(req.user.id);

    if (!isAdmin(user)) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const result = await pool.query(
      `SELECT
         t.*,
         u.name AS customer_name,
         u.email AS customer_email
       FROM help_support_tickets t
       JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC`,
    );

    return res.status(200).json({
      success: true,
      tickets: result.rows,
    });
  } catch (error) {
    console.error("Get all help tickets error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch support tickets",
    });
  }
};

// ==========================================
// GET HELP SUPPORT TICKET DETAILS
// ==========================================

export const getHelpSupportTicketById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    const user = await getCurrentUser(req.user.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    const ticketResult = await pool.query(
      `SELECT *
       FROM help_support_tickets
       WHERE id = $1`,
      [id],
    );

    const ticket = ticketResult.rows[0];

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    if (!isAdmin(user) && Number(ticket.user_id) !== Number(user.id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const messagesResult = await pool.query(
      `SELECT
         m.*,
         u.name AS sender_name
       FROM help_support_messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC, m.id ASC`,
      [id],
    );

    return res.status(200).json({
      success: true,
      ticket,
      messages: messagesResult.rows,
    });
  } catch (error) {
    console.error("Get ticket details error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch ticket details",
    });
  }
};

// ==========================================
// SEND HELP SUPPORT MESSAGE
// ==========================================

export const sendHelpSupportMessage = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT id, role FROM users WHERE id = $1",
      [req.user.id],
    );

    const user = userResult.rows[0];

    if (!user) {
      await client.query("ROLLBACK");

      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    const ticketResult = await client.query(
      `SELECT *
       FROM help_support_tickets
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    const ticket = ticketResult.rows[0];

    if (!ticket) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    const admin = isAdmin(user);

    if (!admin && Number(ticket.user_id) !== Number(user.id)) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    if (ticket.status === "closed") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Cannot reply to a closed ticket",
      });
    }

    const senderType = admin ? "admin" : "user";

    const result = await client.query(
      `INSERT INTO help_support_messages
       (ticket_id, sender_id, sender_type, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, user.id, senderType, message.trim()],
    );

    await client.query(
      `UPDATE help_support_tickets
       SET updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Send help message error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to send message",
    });
  } finally {
    client.release();
  }
};

// ==========================================
// UPDATE HELP SUPPORT STATUS - ADMIN
// ==========================================

export const updateHelpSupportTicketStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket status",
      });
    }

    const user = await getCurrentUser(req.user.id);

    if (!isAdmin(user)) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const result = await pool.query(
      `UPDATE help_support_tickets
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ticket status updated successfully",
      ticket: result.rows[0],
    });
  } catch (error) {
    console.error("Update ticket status error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to update ticket status",
    });
  }
};
