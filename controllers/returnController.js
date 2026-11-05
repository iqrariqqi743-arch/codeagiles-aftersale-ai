import pool from "../config/db.js";
import crypto from "node:crypto";

const RETURN_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "received",
  "completed",
  "cancelled",
];

const REFUND_STATUSES = [
  "not_started",
  "pending",
  "processing",
  "completed",
  "failed",
];

const REQUEST_TYPES = ["return", "exchange", "refund"];

const errorResponse = (res, error, message) => {
  console.error(message, error);

  if (error.code === "22P02" || error.code === "22003") {
    return res.status(400).json({
      success: false,
      message: "Invalid ID or numeric value",
    });
  }

  return res.status(500).json({
    success: false,
    message,
  });
};

const getOwnedReturn = async (client, id, userId) => {
  const result = await client.query(
    `SELECT r.*
     FROM returns r
     INNER JOIN stores s
       ON s.id = r.store_id
       AND s.user_id = r.user_id
     INNER JOIN orders o
       ON o.id = r.order_id
       AND o.store_id = r.store_id
       AND o.user_id = r.user_id
     WHERE r.id = $1
       AND r.user_id = $2
     FOR UPDATE OF r`,
    [id, userId],
  );

  return result.rows[0] || null;
};

// GET /api/returns
export const getReturns = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        r.*,
        s.store_name,
        o.order_number,
        o.currency,
        o.total_amount AS order_total,
        t.ticket_number
       FROM returns r
       INNER JOIN stores s
         ON s.id = r.store_id
         AND s.user_id = r.user_id
       INNER JOIN orders o
         ON o.id = r.order_id
         AND o.store_id = r.store_id
         AND o.user_id = r.user_id
       LEFT JOIN tickets t
         ON t.id = r.ticket_id
         AND t.user_id = r.user_id
         AND t.store_id = r.store_id
         AND t.order_id = r.order_id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC, r.id DESC`,
      [req.user.id],
    );

    return res.json({
      success: true,
      returns: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    return errorResponse(res, error, "Failed to fetch returns");
  }
};

// POST /api/returns
export const createReturn = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;

    const {
      store_id,
      order_id,
      ticket_id,
      customer_name,
      customer_email,
      reason,
      description,
      request_type = "return",
      refund_amount = 0,
    } = req.body || {};

    if (
      !store_id ||
      !order_id ||
      typeof customer_name !== "string" ||
      !customer_name.trim() ||
      typeof reason !== "string" ||
      !reason.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Store, order, customer name and reason are required",
      });
    }

    if (!REQUEST_TYPES.includes(request_type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request type",
      });
    }

    const amount = Number(refund_amount);

    if (
      refund_amount === null ||
      typeof refund_amount === "boolean" ||
      String(refund_amount).trim() === "" ||
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Refund amount must be a valid non-negative number",
      });
    }

    if (
      customer_name.trim().length > 150 ||
      reason.trim().length > 100 ||
      (customer_email &&
        (typeof customer_email !== "string" || customer_email.length > 255)) ||
      (description &&
        (typeof description !== "string" || description.length > 10000))
    ) {
      return res.status(400).json({
        success: false,
        message: "One or more fields are invalid or too long",
      });
    }

    await client.query("BEGIN");

    const orderResult = await client.query(
      `SELECT o.id, o.is_demo, o.total_amount, o.currency
       FROM orders o
       INNER JOIN stores s
         ON s.id = o.store_id
         AND s.user_id = o.user_id
       WHERE o.id = $1
         AND o.store_id = $2
         AND o.user_id = $3`,
      [order_id, store_id, userId],
    );

    if (!orderResult.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Order not found for your store",
      });
    }

    const order = orderResult.rows[0];

    if (amount > Number(order.total_amount)) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Refund amount cannot exceed order total",
      });
    }

    let validTicketId = null;

    if (ticket_id !== undefined && ticket_id !== null && ticket_id !== "") {
      const ticketResult = await client.query(
        `SELECT id
         FROM tickets
         WHERE id = $1
           AND user_id = $2
           AND store_id = $3
           AND order_id = $4`,
        [ticket_id, userId, store_id, order_id],
      );

      if (!ticketResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          message: "Linked ticket does not belong to this order",
        });
      }

      validTicketId = ticketResult.rows[0].id;
    }

    const storeResult = await client.query(
      `SELECT status
       FROM stores
       WHERE id = $1 AND user_id = $2`,
      [store_id, userId],
    );

    const isDemo =
      order.is_demo === true || storeResult.rows[0]?.status !== "connected";

    const returnNumber = `RET-${crypto
      .randomBytes(8)
      .toString("hex")
      .toUpperCase()}`;

    const result = await client.query(
      `INSERT INTO returns (
        user_id,
        store_id,
        order_id,
        ticket_id,
        return_number,
        customer_name,
        customer_email,
        reason,
        description,
        request_type,
        status,
        refund_amount,
        refund_status,
        is_demo
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        'pending',$11,'not_started',$12
      )
      RETURNING *`,
      [
        userId,
        store_id,
        order_id,
        validTicketId,
        returnNumber,
        customer_name.trim(),
        typeof customer_email === "string"
          ? customer_email.trim() || null
          : null,
        reason.trim(),
        typeof description === "string" ? description.trim() || null : null,
        request_type,
        amount,
        isDemo,
      ],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Return request created successfully",
      return_request: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return errorResponse(res, error, "Failed to create return request");
  } finally {
    client.release();
  }
};

// GET /api/returns/:id
export const getReturnById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        r.*,
        s.store_name,
        o.order_number,
        o.currency,
        o.total_amount AS order_total,
        t.ticket_number
       FROM returns r
       INNER JOIN stores s
         ON s.id = r.store_id
         AND s.user_id = r.user_id
       INNER JOIN orders o
         ON o.id = r.order_id
         AND o.store_id = r.store_id
         AND o.user_id = r.user_id
       LEFT JOIN tickets t
         ON t.id = r.ticket_id
         AND t.user_id = r.user_id
         AND t.store_id = r.store_id
         AND t.order_id = r.order_id
       WHERE r.id = $1 AND r.user_id = $2`,
      [req.params.id, req.user.id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Return request not found",
      });
    }

    return res.json({
      success: true,
      return_request: result.rows[0],
    });
  } catch (error) {
    return errorResponse(res, error, "Failed to fetch return details");
  }
};

// PATCH /api/returns/:id/status
export const updateReturnStatus = async (req, res) => {
  const client = await pool.connect();

  try {
    const { status, admin_notes } = req.body || {};

    if (!RETURN_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid return status",
      });
    }

    if (
      admin_notes !== undefined &&
      (typeof admin_notes !== "string" || admin_notes.length > 10000)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid notes",
      });
    }

    await client.query("BEGIN");

    const current = await getOwnedReturn(client, req.params.id, req.user.id);

    if (!current) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Return request not found",
      });
    }

    const transitions = {
      pending: ["approved", "rejected", "cancelled"],
      approved: ["received", "completed", "cancelled"],
      received: ["completed"],
      rejected: [],
      completed: [],
      cancelled: [],
    };

    if (
      status !== current.status &&
      !transitions[current.status]?.includes(status)
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: `Cannot change status from ${current.status} to ${status}`,
      });
    }

    const result = await client.query(
      `UPDATE returns
       SET status = $1,
           admin_notes = COALESCE($2, admin_notes),
           updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [
        status,
        admin_notes === undefined ? null : admin_notes.trim(),
        req.params.id,
        req.user.id,
      ],
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Return status updated successfully",
      return_request: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return errorResponse(res, error, "Failed to update return status");
  } finally {
    client.release();
  }
};

// PATCH /api/returns/:id/refund
// Tracks a manually performed refund.
// Does NOT send money to the customer.
export const updateRefundStatus = async (req, res) => {
  const client = await pool.connect();

  try {
    const { refund_status } = req.body || {};

    if (!REFUND_STATUSES.includes(refund_status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid refund status",
      });
    }

    await client.query("BEGIN");

    const current = await getOwnedReturn(client, req.params.id, req.user.id);

    if (!current) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Return request not found",
      });
    }

    if (!["approved", "received", "completed"].includes(current.status)) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Approve the return before updating refund status",
      });
    }

    if (current.request_type === "exchange") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Refund tracking is not available for exchange requests",
      });
    }

    if (Number(current.refund_amount) <= 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Refund amount must be greater than zero",
      });
    }

    const transitions = {
      not_started: ["pending"],
      pending: ["processing", "failed"],
      processing: ["completed", "failed"],
      failed: ["pending"],
      completed: [],
    };

    if (
      refund_status !== current.refund_status &&
      !transitions[current.refund_status]?.includes(refund_status)
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: `Cannot change refund status from ${current.refund_status} to ${refund_status}`,
      });
    }

    const result = await client.query(
      `UPDATE returns
       SET refund_status = $1,
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [refund_status, req.params.id, req.user.id],
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Refund tracking status updated. No payment was executed.",
      return_request: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return errorResponse(res, error, "Failed to update refund status");
  } finally {
    client.release();
  }
};
