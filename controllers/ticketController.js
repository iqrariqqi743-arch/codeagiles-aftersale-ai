import pool from "../config/db.js";
import crypto from "node:crypto";
import { sendTicketReplyEmail } from "../services/emailService.js";

// ==========================================
// CONSTANTS
// ==========================================

const ALLOWED_STATUSES = [
  "open",
  "in_progress",
  "waiting_customer",
  "resolved",
  "closed",
];

const ALLOWED_PRIORITIES = ["low", "medium", "high", "urgent"];

const ALLOWED_CATEGORIES = [
  "general",
  "delivery",
  "damaged_product",
  "wrong_product",
  "return",
  "refund",
  "other",
];

// ==========================================
// HELPERS
// ==========================================

const getErrorMessage = (error) => {
  if (error?.code === "23503") {
    return "Related store or order was not found";
  }

  if (error?.code === "22P02") {
    return "Invalid ID";
  }

  return "An unexpected database error occurred";
};

const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
};

const allowDemoEmails = () => {
  return process.env.SEND_DEMO_EMAILS === "true";
};

// ==========================================
// GET ALL TICKETS
// GET /api/tickets
// ==========================================

export const getTickets = async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          t.*,
          s.store_name,
          o.order_number,
          (
            SELECT COUNT(*)::INTEGER
            FROM ticket_messages tm
            WHERE tm.ticket_id = t.id
          ) AS message_count
        FROM tickets t
        INNER JOIN stores s
          ON s.id = t.store_id
          AND s.user_id = t.user_id
        LEFT JOIN orders o
          ON o.id = t.order_id
          AND o.user_id = t.user_id
          AND o.store_id = t.store_id
        WHERE t.user_id = $1
        ORDER BY t.created_at DESC, t.id DESC
      `,
      [req.user.id],
    );

    return res.status(200).json({
      success: true,
      tickets: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Get tickets error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch tickets",
    });
  }
};

// ==========================================
// CREATE TICKET
// POST /api/tickets
// ==========================================

export const createTicket = async (req, res) => {
  let client;

  try {
    client = await pool.connect();

    const userId = req.user.id;

    const {
      store_id,
      order_id,
      customer_name,
      customer_email,
      subject,
      description,
      category = "general",
      priority = "medium",
    } = req.body || {};

    if (
      !store_id ||
      typeof customer_name !== "string" ||
      !customer_name.trim() ||
      typeof subject !== "string" ||
      !subject.trim() ||
      typeof description !== "string" ||
      !description.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Store, customer name, subject and description are required",
      });
    }

    if (
      customer_name.trim().length > 150 ||
      subject.trim().length > 255 ||
      description.trim().length > 10000 ||
      (customer_email &&
        (typeof customer_email !== "string" || customer_email.length > 255))
    ) {
      return res.status(400).json({
        success: false,
        message: "One or more fields exceed the allowed length",
      });
    }

    if (customer_email && !isValidEmail(customer_email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer email address",
      });
    }

    if (
      !ALLOWED_CATEGORIES.includes(category) ||
      !ALLOWED_PRIORITIES.includes(priority)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket category or priority",
      });
    }

    await client.query("BEGIN");

    // Verify store ownership
    const storeResult = await client.query(
      `
        SELECT id, status
        FROM stores
        WHERE id = $1
          AND user_id = $2
      `,
      [store_id, userId],
    );

    if (!storeResult.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    let validOrderId = null;
    let isDemo = false;

    // Verify order ownership
    if (order_id !== undefined && order_id !== null && order_id !== "") {
      const orderResult = await client.query(
        `
          SELECT id, is_demo
          FROM orders
          WHERE id = $1
            AND store_id = $2
            AND user_id = $3
        `,
        [order_id, store_id, userId],
      );

      if (!orderResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          message: "Order not found for this store",
        });
      }

      validOrderId = orderResult.rows[0].id;

      isDemo = orderResult.rows[0].is_demo === true;
    }

    // Disconnected stores create demo tickets
    if (storeResult.rows[0].status !== "connected") {
      isDemo = true;
    }

    const ticketNumber = `TKT-${crypto
      .randomBytes(8)
      .toString("hex")
      .toUpperCase()}`;

    const result = await client.query(
      `
        INSERT INTO tickets (
          user_id,
          store_id,
          order_id,
          ticket_number,
          customer_name,
          customer_email,
          subject,
          description,
          category,
          priority,
          status,
          is_demo
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, 'open', $11
        )
        RETURNING *
      `,
      [
        userId,
        store_id,
        validOrderId,
        ticketNumber,
        customer_name.trim(),
        typeof customer_email === "string"
          ? customer_email.trim() || null
          : null,
        subject.trim(),
        description.trim(),
        category,
        priority,
        isDemo,
      ],
    );

    // Save initial customer complaint
    await client.query(
      `
        INSERT INTO ticket_messages (
          ticket_id,
          sender_type,
          message
        )
        VALUES ($1, 'customer', $2)
      `,
      [result.rows[0].id, description.trim()],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      ticket: result.rows[0],
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Create ticket rollback error:", rollbackError.message);
      }
    }

    console.error("Create ticket error:", error.message);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  } finally {
    client?.release();
  }
};

// ==========================================
// GET TICKET DETAILS
// GET /api/tickets/:id
// ==========================================

export const getTicketById = async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          t.*,
          s.store_name,
          o.order_number,

          CASE
            WHEN o.id IS NULL THEN NULL
            ELSE json_build_object(
              'id', o.id,
              'order_number', o.order_number,
              'customer_name', o.customer_name,
              'customer_email', o.customer_email,
              'customer_phone', o.customer_phone,
              'currency', o.currency,
              'total_amount', o.total_amount,
              'status', o.status,
              'payment_method', o.payment_method,
              'shipping_address', o.shipping_address,
              'order_date', o.order_date,

              'items',
              COALESCE(
                (
                  SELECT json_agg(
                    json_build_object(
                      'id', oi.id,
                      'product_name', oi.product_name,
                      'product_image', oi.product_image,
                      'product_sku', oi.product_sku,
                      'quantity', oi.quantity,
                      'unit_price', oi.unit_price,
                      'color', oi.color,
                      'size', oi.size,
                      'variation', oi.variation
                    )
                    ORDER BY oi.id
                  )
                  FROM order_items oi
                  WHERE oi.order_id = o.id
                ),
                '[]'::json
              )
            )
          END AS linked_order

        FROM tickets t

        INNER JOIN stores s
          ON s.id = t.store_id
          AND s.user_id = t.user_id

        LEFT JOIN orders o
          ON o.id = t.order_id
          AND o.user_id = t.user_id
          AND o.store_id = t.store_id

        WHERE t.id = $1
          AND t.user_id = $2
      `,
      [req.params.id, req.user.id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const ticket = result.rows[0];
    const linkedOrder = ticket.linked_order;

    // =====================================
    // ORDER CUSTOMER VERIFICATION
    // =====================================

    let orderVerification = {
      status: "no_linked_order",
      message: "No linked order found",
      customerEmailMatch: false,
      customerNameMatch: false,
    };

    if (linkedOrder) {
      const ticketEmail = (ticket.customer_email || "").trim().toLowerCase();

      const orderEmail = (linkedOrder.customer_email || "")
        .trim()
        .toLowerCase();

      const ticketName = (ticket.customer_name || "").trim().toLowerCase();

      const orderName = (linkedOrder.customer_name || "").trim().toLowerCase();

      const customerEmailMatch =
        ticketEmail !== "" && orderEmail !== "" && ticketEmail === orderEmail;

      const customerNameMatch =
        ticketName !== "" && orderName !== "" && ticketName === orderName;

      const hasProducts =
        Array.isArray(linkedOrder.items) && linkedOrder.items.length > 0;

      if (!customerEmailMatch) {
        orderVerification = {
          status: "customer_mismatch",
          message: "Customer email does not match the linked order",
          customerEmailMatch: false,
          customerNameMatch,
        };
      } else if (!hasProducts) {
        orderVerification = {
          status: "no_products",
          message: "No products found in this order",
          customerEmailMatch: true,
          customerNameMatch,
        };
      } else {
        orderVerification = {
          status: "verified",
          message: "Customer email and order products verified",
          customerEmailMatch: true,
          customerNameMatch,
        };
      }
    }

    // =====================================
    // FETCH TICKET MESSAGES
    // =====================================

    const messages = await pool.query(
      `
        SELECT
          tm.id,
          tm.ticket_id,
          tm.sender_type,
          tm.message,
          tm.created_at
        FROM ticket_messages tm
        INNER JOIN tickets t
          ON t.id = tm.ticket_id
        WHERE tm.ticket_id = $1
          AND t.user_id = $2
        ORDER BY tm.created_at ASC, tm.id ASC
      `,
      [req.params.id, req.user.id],
    );

    // =====================================
    // FINAL RESPONSE
    // =====================================

    return res.status(200).json({
      success: true,
      ticket: {
        ...ticket,
        order_verification: orderVerification,
      },
      messages: messages.rows,
    });
  } catch (error) {
    console.error("Get ticket details error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch ticket details",
    });
  }
};

// ==========================================
// UPDATE TICKET STATUS
// PATCH /api/tickets/:id/status
// ==========================================

export const updateTicketStatus = async (req, res) => {
  try {
    const { status } = req.body || {};

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket status",
      });
    }

    const result = await pool.query(
      `
        UPDATE tickets
        SET
          status = $1,
          updated_at = NOW()
        WHERE id = $2
          AND user_id = $3
          AND EXISTS (
            SELECT 1
            FROM stores s
            WHERE s.id = tickets.store_id
              AND s.user_id = $3
          )
        RETURNING *
      `,
      [status, req.params.id, req.user.id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
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

// ==========================================
// ADD TICKET REPLY + EMAIL NOTIFICATION
// POST /api/tickets/:id/messages
// ==========================================

export const addTicketMessage = async (req, res) => {
  let client = null;
  let transactionStarted = false;
  let committed = false;

  let savedMessage = null;
  let approvalId = null;
  let approvalType = null;
  let ticket = null;
  let orderVerificationStatus = "no_linked_order";
  let customerEmailMatch = false;

  try {
    const { message } = req.body || {};

    const finalMessage = typeof message === "string" ? message.trim() : "";

    if (!finalMessage || finalMessage.length > 10000) {
      return res.status(400).json({
        success: false,
        message: "Message must be between 1 and 10000 characters",
      });
    }

    const { id: ticketId } = req.params;
    const userId = req.user.id;

    if (!/^\d+$/.test(String(ticketId || ""))) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // --------------------------------------------------
    // 1. Find ticket and verify ownership
    // --------------------------------------------------

    const ticketResult = await client.query(
      `
        SELECT
          t.id,
          t.user_id,
          t.store_id,
          t.order_id,
          t.ticket_number,
          t.customer_name,
          t.customer_email,
          t.subject,
          t.status,
          t.is_demo,
          s.store_name
        FROM tickets t
        INNER JOIN stores s
          ON s.id = t.store_id
          AND s.user_id = t.user_id
        WHERE t.id = $1
          AND t.user_id = $2
        FOR UPDATE OF t
      `,
      [ticketId, userId],
    );

    if (!ticketResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    ticket = ticketResult.rows[0];

    // --------------------------------------------------
    // 2. Check linked order
    // --------------------------------------------------

    let linkedOrder = null;

    if (ticket.order_id) {
      const orderResult = await client.query(
        `
          SELECT
            o.id,
            o.customer_name,
            o.customer_email,
            o.order_number,
            o.total_amount,
            o.currency,
            o.status,
            EXISTS (
              SELECT 1
              FROM order_items oi
              WHERE oi.order_id = o.id
            ) AS has_products
          FROM orders o
          WHERE o.id = $1
            AND o.user_id = $2
            AND o.store_id = $3
          LIMIT 1
          FOR UPDATE OF o
        `,
        [ticket.order_id, userId, ticket.store_id],
      );

      linkedOrder = orderResult.rows[0] || null;
    }

    const normalize = (value) =>
      String(value ?? "")
        .trim()
        .toLowerCase();

    const ticketEmail = normalize(ticket.customer_email);
    const orderEmail = normalize(linkedOrder?.customer_email);

    customerEmailMatch =
      Boolean(ticketEmail) && Boolean(orderEmail) && ticketEmail === orderEmail;

    if (linkedOrder) {
      if (!customerEmailMatch) {
        orderVerificationStatus = "customer_mismatch";
      } else if (linkedOrder.has_products !== true) {
        orderVerificationStatus = "no_products";
      } else {
        orderVerificationStatus = "verified";
      }
    }

    const isOrderVerified = orderVerificationStatus === "verified";

    // --------------------------------------------------
    // 3. Get latest approved reply
    // --------------------------------------------------

    const approvalResult = await client.query(
      `
        SELECT
          id,
          approved_message,
          approval_type,
          approved_order_id,
          verification_status,
          status
        FROM ticket_reply_approvals
        WHERE ticket_id = $1
          AND user_id = $2
          AND status = 'approved'
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [ticket.id, userId],
    );

    if (!approvalResult.rows.length) {
      return res.status(403).json({
        success: false,
        message: "Please approve this reply before sending it",
      });
    }

    const approval = approvalResult.rows[0];

    approvalType = approval.approval_type;

    // --------------------------------------------------
    // 4. Support all three approval types
    // --------------------------------------------------

    const allowedApprovalTypes = [
      "general_support",
      "verification_request",
      "order_specific",
    ];

    if (!allowedApprovalTypes.includes(approvalType)) {
      return res.status(403).json({
        success: false,
        message: "Invalid reply approval type",
      });
    }

    // --------------------------------------------------
    // 5. Verify approved order binding
    // --------------------------------------------------

    const approvedOrderId =
      approval.approved_order_id == null
        ? null
        : String(approval.approved_order_id);

    const currentOrderId = linkedOrder == null ? null : String(linkedOrder.id);

    if (approvedOrderId !== currentOrderId) {
      return res.status(409).json({
        success: false,
        message:
          "The linked order has changed since approval. Please approve the reply again.",
      });
    }

    // --------------------------------------------------
    // 6. Verify status has not changed
    // --------------------------------------------------

    if (approval.verification_status !== orderVerificationStatus) {
      return res.status(409).json({
        success: false,
        message:
          "Order verification status has changed. Please approve the reply again.",
        order_verification: {
          status: orderVerificationStatus,
          customerEmailMatch,
        },
      });
    }

    // --------------------------------------------------
    // 7. Validate approval type
    // --------------------------------------------------

    if (approvalType === "order_specific" && !isOrderVerified) {
      return res.status(403).json({
        success: false,
        message:
          "Order-specific reply is blocked because this order is not verified.",
      });
    }

    if (approvalType === "verification_request" && isOrderVerified) {
      return res.status(409).json({
        success: false,
        message:
          "Order is now verified. Please generate and approve a new reply.",
      });
    }

    // --------------------------------------------------
    // 8. Exact approved message validation
    // --------------------------------------------------

    if (approval.approved_message !== finalMessage) {
      return res.status(403).json({
        success: false,
        message:
          "Reply has changed after approval. Please approve the updated reply again.",
      });
    }

    // --------------------------------------------------
    // 9. Prevent general_support from bypassing
    //    verification cooldown
    // --------------------------------------------------

    if (approvalType === "general_support") {
      const verificationPatterns = [
        /\bverify\s+(your|the|this)?\s*(email|identity|order|account|ownership)\b/i,
        /\bconfirm\s+(your|the)?\s*(registered|billing|order)\s*email\b/i,
        /\b(email|address)\s+(registered|associated|linked)\s+with\s+(your|the)?\s*order\b/i,
        /\bprovide\s+(your|the)?\s*(order\s*(number|id)|registered\s*email)\b/i,
        /\bshare\s+(your|the)?\s*(order\s*(number|id)|registered\s*email)\b/i,
        /\b(send|provide|share)\s+(us\s+)?(your\s+)?order\s+number\b/i,
        /\bverification\s+(is\s+)?required\b/i,
        /\buntil\s+(your|the)?\s*(email|identity|order)\s+(is\s+)?verified\b/i,
      ];

      const requestsVerification = verificationPatterns.some((pattern) =>
        pattern.test(finalMessage),
      );

      if (requestsVerification) {
        return res.status(403).json({
          success: false,
          message:
            "This reply requests order verification. Approve it as verification_request.",
        });
      }
    }

    // --------------------------------------------------
    // 10. 24-hour cooldown
    // ONLY verification_request
    // --------------------------------------------------

    if (approvalType === "verification_request") {
      const cooldownResult = await client.query(
        `
          SELECT
            id,
            status,
            sent_at,
            CASE
              WHEN sent_at IS NOT NULL
              THEN sent_at + INTERVAL '24 hours'
              ELSE NULL
            END AS next_allowed_at
          FROM ticket_reply_approvals
          WHERE ticket_id = $1
            AND user_id = $2
            AND approval_type = 'verification_request'
            AND (
              status = 'sending'
              OR (
                status = 'sent'
                AND sent_at > NOW() - INTERVAL '24 hours'
              )
            )
          ORDER BY
            CASE
              WHEN status = 'sending' THEN 0
              ELSE 1
            END,
            sent_at DESC NULLS LAST,
            id DESC
          LIMIT 1
        `,
        [ticket.id, userId],
      );

      if (cooldownResult.rows.length) {
        const recentApproval = cooldownResult.rows[0];

        if (recentApproval.status === "sending") {
          return res.status(409).json({
            success: false,
            cooldown: true,
            message:
              "A verification email is already being processed for this ticket.",
            approval_id: recentApproval.id,
          });
        }

        return res.status(429).json({
          success: false,
          cooldown: true,
          message:
            "A verification email was already sent within the last 24 hours.",
          approval_id: recentApproval.id,
          last_sent_at: recentApproval.sent_at,
          next_allowed_at: recentApproval.next_allowed_at,
        });
      }
    }

    // --------------------------------------------------
    // 11. Protect private order information
    // Applies to ALL unverified replies
    // --------------------------------------------------

    if (!isOrderVerified && linkedOrder) {
      const privateOrderResult = await client.query(
        `
          SELECT
            o.customer_name,
            o.customer_email,
            o.order_number,
            oi.product_name,
            oi.product_sku
          FROM orders o
          LEFT JOIN order_items oi
            ON oi.order_id = o.id
          WHERE o.id = $1
            AND o.user_id = $2
            AND o.store_id = $3
        `,
        [linkedOrder.id, userId, ticket.store_id],
      );

      const privateValues = [];

      for (const row of privateOrderResult.rows) {
        if (!customerEmailMatch && row.customer_email) {
          privateValues.push(row.customer_email);
        }

        if (normalize(row.customer_name) !== normalize(ticket.customer_name)) {
          privateValues.push(row.customer_name);
        }

        privateValues.push(row.order_number, row.product_name, row.product_sku);
      }

      const normalizedReply = normalize(finalMessage);

      const containsPrivateData = privateValues
        .map(normalize)
        .filter((value) => value.length >= 3)
        .some((value) => normalizedReply.includes(value));

      if (containsPrivateData) {
        return res.status(403).json({
          success: false,
          message:
            "Reply contains private linked-order information that cannot be shared before verification.",
        });
      }

      const privateDetailPatterns = [
        /\byour\s+order\s+(total|amount)\s+is\b/i,
        /\byour\s+order\s+(status|tracking\s+number)\s+is\b/i,
        /\byour\s+order\s+contains\b/i,
        /\byour\s+order\s+was\s+(shipped|delivered|cancelled|refunded)\b/i,
      ];

      if (privateDetailPatterns.some((pattern) => pattern.test(finalMessage))) {
        return res.status(403).json({
          success: false,
          message:
            "Private order details cannot be disclosed in an unverified reply.",
        });
      }
    }

    // --------------------------------------------------
    // 12. Generic greeting for unverified tickets
    // --------------------------------------------------

    if (!isOrderVerified) {
      const hasGenericGreeting = /^hello(?:\s*[,!.]|\s*\n)/i.test(finalMessage);

      const hasNameGreeting = /^(hello|dear)\s+[^\n,]+,/i.test(finalMessage);

      if (!hasGenericGreeting || hasNameGreeting) {
        return res.status(403).json({
          success: false,
          message:
            'For an unverified ticket, start with "Hello," without a customer name.',
        });
      }
    }

    // --------------------------------------------------
    // 13. Consume approval exactly once
    // --------------------------------------------------

    approvalId = approval.id;

    const approvalUpdateResult = await client.query(
      `
        UPDATE ticket_reply_approvals
        SET status = 'sending'
        WHERE id = $1
          AND ticket_id = $2
          AND user_id = $3
          AND approved_order_id IS NOT DISTINCT FROM $4::BIGINT
          AND verification_status = $5
          AND status = 'approved'
        RETURNING id
      `,
      [approvalId, ticket.id, userId, approvedOrderId, orderVerificationStatus],
    );

    if (!approvalUpdateResult.rows.length) {
      return res.status(409).json({
        success: false,
        message: "This reply approval has already been used or changed",
      });
    }

    // --------------------------------------------------
    // 14. Save owner reply
    // --------------------------------------------------

    const messageResult = await client.query(
      `
        INSERT INTO ticket_messages (
          ticket_id,
          sender_type,
          message
        )
        VALUES ($1, 'owner', $2)
        RETURNING *
      `,
      [ticket.id, finalMessage],
    );

    savedMessage = messageResult.rows[0];

    // --------------------------------------------------
    // 15. Update ticket timestamp
    // --------------------------------------------------

    await client.query(
      `
        UPDATE tickets
        SET updated_at = NOW()
        WHERE id = $1
          AND user_id = $2
      `,
      [ticket.id, userId],
    );

    // --------------------------------------------------
    // 16. Commit before SMTP
    // --------------------------------------------------

    await client.query("COMMIT");

    transactionStarted = false;
    committed = true;

    // --------------------------------------------------
    // 17. Send email
    // --------------------------------------------------

    const emailNotification = {
      status: "skipped",
      sent: false,
      reason: null,
    };

    if (ticket.is_demo === true && !allowDemoEmails()) {
      emailNotification.reason = "Demo ticket email notifications are disabled";
    } else if (!ticket.customer_email || !isValidEmail(ticket.customer_email)) {
      emailNotification.reason = "Customer email is missing or invalid";
    } else if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      emailNotification.reason = "SMTP credentials are not configured";
    } else {
      try {
        const emailResult = await sendTicketReplyEmail({
          customerEmail: ticket.customer_email,

          customerName:
            approvalType === "order_specific" ? ticket.customer_name : null,

          ticketNumber: ticket.ticket_number,
          storeName: ticket.store_name,
          reply: finalMessage,
        });

        emailNotification.status = "sent";
        emailNotification.sent = true;
        emailNotification.messageId = emailResult?.messageId || null;

        console.log("Customer email accepted by SMTP:", {
          ticketId: ticket.id,
          approvalId,
          approvalType,
          messageId: emailNotification.messageId,
        });
      } catch (emailError) {
        console.error("Ticket email notification failed:", {
          ticketId: ticket.id,
          approvalId,
          error: emailError.message,
          code: emailError.code,
          response: emailError.response,
        });

        emailNotification.status = "failed";
        emailNotification.reason = "Email sending failed. Reply was saved.";
      }
    }

    // --------------------------------------------------
    // 18. Update approval status
    // --------------------------------------------------

    const finalApprovalStatus = emailNotification.sent ? "sent" : "cancelled";

    let approvalStatusUpdated = false;

    try {
      const finalUpdate = await client.query(
        `
          UPDATE ticket_reply_approvals
          SET
            status = $1::varchar,
            sent_at = CASE
              WHEN $1::varchar = 'sent'
              THEN NOW()
              ELSE sent_at
            END
          WHERE id = $2
            AND ticket_id = $3
            AND user_id = $4
            AND status = 'sending'
          RETURNING id, status, sent_at
        `,
        [finalApprovalStatus, approvalId, ticket.id, userId],
      );

      approvalStatusUpdated = finalUpdate.rows.length > 0;

      if (!approvalStatusUpdated) {
        console.error("Approval final status update returned no rows:", {
          approvalId,
        });
      }
    } catch (approvalUpdateError) {
      console.error("Approval final status update error:", {
        approvalId,
        message: approvalUpdateError.message,
        code: approvalUpdateError.code,
      });
    }

    // --------------------------------------------------
    // 19. Build truthful response
    // --------------------------------------------------

    let responseMessage;

    if (emailNotification.sent && approvalStatusUpdated) {
      responseMessage = "Reply saved and email notification sent.";
    } else if (emailNotification.sent && !approvalStatusUpdated) {
      responseMessage =
        "Email was accepted by SMTP, but approval status update is pending. Do not resend this reply.";
    } else if (!emailNotification.sent && approvalStatusUpdated) {
      responseMessage = "Reply saved, but email notification was not sent.";
    } else {
      responseMessage =
        "Reply saved. Email and approval status need verification.";
    }

    return res.status(201).json({
      success: true,
      message: responseMessage,
      ticket_message: savedMessage,

      order_verification: {
        status: orderVerificationStatus,
        customerEmailMatch,
      },

      approval_type: approvalType,
      approval_id: approvalId,
      approval_status_updated: approvalStatusUpdated,
      email_notification: emailNotification,
    });
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Reply rollback error:", rollbackError.message);
      }
    }

    console.error("Add ticket message error:", {
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
      stack: error.stack,
    });

    if (committed) {
      return res.status(201).json({
        success: true,
        message:
          "Reply saved. Email notification status could not be confirmed.",
        ticket_message: savedMessage,
        approval_id: approvalId,
        email_notification: {
          status: "unknown",
          sent: false,
        },
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to add reply",
    });
  } finally {
    client?.release();
  }
};

export const approveTicketReply = async (req, res) => {
  let client;
  let transactionStarted = false;

  try {
    const { message, approval_type } = req.body || {};

    const finalMessage = typeof message === "string" ? message.trim() : "";

    if (!finalMessage || finalMessage.length > 10000) {
      return res.status(400).json({
        success: false,
        message: "A valid reply is required for approval",
      });
    }

    const { id: ticketId } = req.params;
    const userId = req.user.id;

    if (!/^\d+$/.test(String(ticketId || ""))) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    // ------------------------------------------------
    // 1. Validate requested approval type
    // ------------------------------------------------

    const allowedApprovalTypes = [
      "general_support",
      "verification_request",
      "order_specific",
    ];

    if (
      approval_type !== undefined &&
      !allowedApprovalTypes.includes(approval_type)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid approval type",
      });
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ------------------------------------------------
    // 2. Verify ticket ownership
    // ------------------------------------------------

    const ticketResult = await client.query(
      `
        SELECT
          t.id,
          t.user_id,
          t.store_id,
          t.order_id,
          t.customer_name,
          t.customer_email
        FROM tickets t
        INNER JOIN stores s
          ON s.id = t.store_id
          AND s.user_id = t.user_id
        WHERE t.id = $1
          AND t.user_id = $2
        FOR UPDATE OF t
      `,
      [ticketId, userId],
    );

    if (!ticketResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const ticket = ticketResult.rows[0];

    // ------------------------------------------------
    // 3. Load linked order
    // ------------------------------------------------

    let linkedOrder = null;

    if (ticket.order_id) {
      const orderResult = await client.query(
        `
          SELECT
            o.id,
            o.customer_name,
            o.customer_email,
            o.order_number,
            o.currency,
            o.total_amount,
            o.status,
            EXISTS (
              SELECT 1
              FROM order_items oi
              WHERE oi.order_id = o.id
            ) AS has_products,
            COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'product_name', oi.product_name,
                    'product_sku', oi.product_sku,
                    'quantity', oi.quantity,
                    'unit_price', oi.unit_price,
                    'color', oi.color,
                    'size', oi.size
                  )
                )
                FROM order_items oi
                WHERE oi.order_id = o.id
              ),
              '[]'::jsonb
            ) AS items
          FROM orders o
          WHERE o.id = $1
            AND o.user_id = $2
            AND o.store_id = $3
          LIMIT 1
          FOR UPDATE OF o
        `,
        [ticket.order_id, userId, ticket.store_id],
      );

      linkedOrder = orderResult.rows[0] || null;
    }

    // ------------------------------------------------
    // 4. Check order verification status
    // ------------------------------------------------

    const normalize = (value) =>
      String(value ?? "")
        .trim()
        .toLowerCase();

    const ticketEmail = normalize(ticket.customer_email);
    const orderEmail = normalize(linkedOrder?.customer_email);

    const customerEmailMatch =
      Boolean(ticketEmail) && Boolean(orderEmail) && ticketEmail === orderEmail;

    let orderVerificationStatus = "no_linked_order";

    if (linkedOrder) {
      if (!customerEmailMatch) {
        orderVerificationStatus = "customer_mismatch";
      } else if (linkedOrder.has_products !== true) {
        orderVerificationStatus = "no_products";
      } else {
        orderVerificationStatus = "verified";
      }
    }

    const isOrderVerified = orderVerificationStatus === "verified";

    // ------------------------------------------------
    // 5. Determine approval type
    // ------------------------------------------------

    // Preserve backward compatibility for old frontend.
    // Explicit approval_type should be sent by updated frontend.

    const approvalType =
      approval_type ||
      (isOrderVerified ? "order_specific" : "verification_request");

    // ------------------------------------------------
    // 6. Validate approval type against verification
    // ------------------------------------------------

    if (approvalType === "order_specific" && !isOrderVerified) {
      return res.status(403).json({
        success: false,
        message: "Order-specific replies require a verified linked order.",
        order_verification: {
          status: orderVerificationStatus,
          customerEmailMatch,
        },
      });
    }

    if (approvalType === "verification_request" && isOrderVerified) {
      return res.status(409).json({
        success: false,
        message:
          "Order is already verified. Generate an order-specific or general-support reply.",
      });
    }

    // ------------------------------------------------
    // 7. Prevent verification cooldown bypass
    // ------------------------------------------------

    // A general_support approval must not be used for
    // asking the customer to verify order ownership.

    if (approvalType === "general_support") {
      const verificationPatterns = [
        /\bverify\s+(your|the|this)?\s*(email|identity|order|account|ownership)\b/i,
        /\bconfirm\s+(your|the)?\s*(registered|billing|order)\s*email\b/i,
        /\b(email|address)\s+(registered|associated|linked)\s+with\s+(your|the)?\s*order\b/i,
        /\bprovide\s+(your|the)?\s*(order\s*(number|id)|registered\s*email)\b/i,
        /\bshare\s+(your|the)?\s*(order\s*(number|id)|registered\s*email)\b/i,
        /\b(send|provide|share)\s+(us\s+)?(your\s+)?order\s+number\b/i,
        /\bverification\s+(is\s+)?required\b/i,
        /\buntil\s+(your|the)?\s*(email|identity|order)\s+(is\s+)?verified\b/i,
      ];

      const looksLikeVerificationRequest = verificationPatterns.some(
        (pattern) => pattern.test(finalMessage),
      );

      if (looksLikeVerificationRequest) {
        return res.status(400).json({
          success: false,
          message:
            "This reply appears to request order verification. Use verification_request instead of general_support.",
        });
      }
    }

    // ------------------------------------------------
    // 8. 24-hour cooldown
    // ONLY verification_request
    // ------------------------------------------------

    if (approvalType === "verification_request") {
      const cooldownResult = await client.query(
        `
          SELECT
            id,
            status,
            sent_at,
            CASE
              WHEN sent_at IS NOT NULL
              THEN sent_at + INTERVAL '24 hours'
              ELSE NULL
            END AS next_allowed_at
          FROM ticket_reply_approvals
          WHERE ticket_id = $1
            AND user_id = $2
            AND approval_type = 'verification_request'
            AND (
              status = 'sending'
              OR (
                status = 'sent'
                AND sent_at > NOW() - INTERVAL '24 hours'
              )
            )
          ORDER BY
            CASE WHEN status = 'sending' THEN 0 ELSE 1 END,
            sent_at DESC NULLS LAST,
            id DESC
          LIMIT 1
        `,
        [ticket.id, userId],
      );

      if (cooldownResult.rows.length > 0) {
        const recentApproval = cooldownResult.rows[0];

        if (recentApproval.status === "sending") {
          return res.status(409).json({
            success: false,
            cooldown: true,
            message:
              "A verification email is already being processed for this ticket.",
            approval_id: recentApproval.id,
          });
        }

        return res.status(429).json({
          success: false,
          cooldown: true,
          message:
            "A verification email was already sent within the last 24 hours.",
          approval_id: recentApproval.id,
          last_sent_at: recentApproval.sent_at,
          next_allowed_at: recentApproval.next_allowed_at,
        });
      }
    }

    // ------------------------------------------------
    // 9. Protect private order information
    // ------------------------------------------------

    if (!isOrderVerified && linkedOrder) {
      const privateOrderValues = [
        linkedOrder.order_number,

        // Avoid blocking the ticket customer's own email/name.
        customerEmailMatch ? null : linkedOrder.customer_email,

        normalize(linkedOrder.customer_name) === normalize(ticket.customer_name)
          ? null
          : linkedOrder.customer_name,

        ...(Array.isArray(linkedOrder.items)
          ? linkedOrder.items.flatMap((item) => [
              item.product_name,
              item.product_sku,
            ])
          : []),
      ]
        .filter((value) => value !== null && value !== undefined)
        .map(normalize)
        .filter((value) => value.length >= 3);

      const normalizedReply = normalize(finalMessage);

      const containsPrivateOrderData = privateOrderValues.some((value) => {
        const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const privateValueRegex = new RegExp(
          `(^|[^a-z0-9])${escapedValue}(?=$|[^a-z0-9])`,
          "i",
        );

        return privateValueRegex.test(normalizedReply);
      });

      if (containsPrivateOrderData) {
        return res.status(403).json({
          success: false,
          message:
            "This unverified reply contains private linked-order information.",
          order_verification: {
            status: orderVerificationStatus,
            customerEmailMatch,
          },
        });
      }

      // Additional protection for structured order details.
      // These patterns are intentionally conservative.

      const privateDetailPatterns = [
        /\byour\s+order\s+(total|amount)\s+is\b/i,
        /\byour\s+order\s+(status|tracking\s+number)\s+is\b/i,
        /\byour\s+order\s+contains\b/i,
        /\byour\s+order\s+was\s+(shipped|delivered|cancelled|refunded)\b/i,
      ];

      if (privateDetailPatterns.some((pattern) => pattern.test(finalMessage))) {
        return res.status(403).json({
          success: false,
          message:
            "Private order details cannot be disclosed in an unverified reply.",
        });
      }
    }

    // ------------------------------------------------
    // 10. Generic greeting for unverified tickets
    // ------------------------------------------------

    if (!isOrderVerified) {
      const hasGenericGreeting = /^hello(?:\s*[,!.]|\s*\n)/i.test(finalMessage);

      const hasNameGreeting = /^(hello|dear)\s+[^\n,]+,/i.test(finalMessage);

      if (!hasGenericGreeting || hasNameGreeting) {
        return res.status(403).json({
          success: false,
          message:
            'For an unverified ticket, start with "Hello," without a customer name.',
        });
      }
    }

    // ------------------------------------------------
    // 11. Cancel previous unused approvals
    // ------------------------------------------------

    await client.query(
      `
        UPDATE ticket_reply_approvals
        SET status = 'cancelled'
        WHERE ticket_id = $1
          AND user_id = $2
          AND status = 'approved'
      `,
      [ticket.id, userId],
    );

    // ------------------------------------------------
    // 12. Create approval
    // ------------------------------------------------

    const approvedOrderId = linkedOrder ? linkedOrder.id : null;

    const approvalResult = await client.query(
      `
        INSERT INTO ticket_reply_approvals (
          ticket_id,
          user_id,
          approved_message,
          approval_type,
          approved_order_id,
          verification_status,
          status,
          approved_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          'approved',
          NOW()
        )
        RETURNING
          id,
          ticket_id,
          approved_message,
          approval_type,
          approved_order_id,
          verification_status,
          status,
          approved_at
      `,
      [
        ticket.id,
        userId,
        finalMessage,
        approvalType,
        approvedOrderId,
        orderVerificationStatus,
      ],
    );

    // ------------------------------------------------
    // 13. Commit transaction
    // ------------------------------------------------

    await client.query("COMMIT");
    transactionStarted = false;

    return res.status(200).json({
      success: true,
      message: "Reply approved successfully",
      approval: approvalResult.rows[0],
      approval_type: approvalType,
      order_verification: {
        status: orderVerificationStatus,
        customerEmailMatch,
      },
      requires_approval: false,
      auto_sent: false,
    });
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Approval rollback error:", rollbackError.message);
      }
    }

    console.error("Approve ticket reply error:", {
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to approve reply",
    });
  } finally {
    client?.release();
  }
};

// ==========================================
// APPLY AI TICKET SUGGESTIONS
// PATCH /api/tickets/:id/apply-ai-suggestions
// ==========================================

export const applyAITicketSuggestions = async (req, res) => {
  let client;

  try {
    const { category, priority } = req.body || {};

    // Validate category
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: "Invalid suggested ticket category",
      });
    }

    // Validate priority
    if (!ALLOWED_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid suggested ticket priority",
      });
    }

    client = await pool.connect();

    await client.query("BEGIN");

    // Verify ticket ownership and lock the ticket
    const ticketResult = await client.query(
      `
        SELECT id
        FROM tickets
        WHERE id = $1
          AND user_id = $2
          AND EXISTS (
            SELECT 1
            FROM stores s
            WHERE s.id = tickets.store_id
              AND s.user_id = $2
          )
        FOR UPDATE
      `,
      [req.params.id, req.user.id],
    );

    if (!ticketResult.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Apply suggestions only after the authenticated owner's request
    const updateResult = await client.query(
      `
        UPDATE tickets
        SET
          category = $1,
          priority = $2,
          updated_at = NOW()
        WHERE id = $3
          AND user_id = $4
        RETURNING *
      `,
      [category, priority, req.params.id, req.user.id],
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "AI suggestions applied successfully",
      ticket: updateResult.rows[0],
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Apply AI suggestions rollback error:",
          rollbackError.message,
        );
      }
    }

    console.error("Apply AI suggestions error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to apply AI suggestions",
    });
  } finally {
    client?.release();
  }
};
