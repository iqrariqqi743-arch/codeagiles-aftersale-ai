import pool from "../config/db.js";

// ==========================================
// ANALYTICS OVERVIEW
// GET /api/analytics/overview
// ==========================================

export const getAnalyticsOverview = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
        WITH user_tickets AS (
          SELECT
            t.id,
            t.status,
            t.is_demo
          FROM tickets t
          INNER JOIN stores s
            ON s.id = t.store_id
            AND s.user_id = t.user_id
          WHERE t.user_id = $1
        ),

        ticket_stats AS (
          SELECT
            COUNT(*)::INTEGER AS total_tickets,
            COUNT(*) FILTER (WHERE status = 'open')::INTEGER AS open_tickets,
            COUNT(*) FILTER (WHERE status = 'in_progress')::INTEGER AS in_progress_tickets,
            COUNT(*) FILTER (WHERE status = 'waiting_customer')::INTEGER AS waiting_customer_tickets,
            COUNT(*) FILTER (WHERE status = 'resolved')::INTEGER AS resolved_tickets,
            COUNT(*) FILTER (WHERE status = 'closed')::INTEGER AS closed_tickets,
            COUNT(*) FILTER (WHERE is_demo = TRUE)::INTEGER AS demo_tickets,
            COUNT(*) FILTER (WHERE is_demo = FALSE)::INTEGER AS real_tickets
          FROM user_tickets
        ),

        message_stats AS (
          SELECT
            COUNT(*)::INTEGER AS total_messages,
            COUNT(*) FILTER (WHERE tm.sender_type = 'customer')::INTEGER AS customer_messages,
            COUNT(*) FILTER (WHERE tm.sender_type = 'owner')::INTEGER AS owner_messages
          FROM ticket_messages tm
          INNER JOIN user_tickets ut ON ut.id = tm.ticket_id
        ),

        approval_stats AS (
          SELECT
            COUNT(*)::INTEGER AS total_approvals,
            COUNT(*) FILTER (WHERE a.status = 'approved')::INTEGER AS approved_approvals,
            COUNT(*) FILTER (WHERE a.status = 'sending')::INTEGER AS sending_approvals,
            COUNT(*) FILTER (WHERE a.status = 'sent')::INTEGER AS sent_approvals,
            COUNT(*) FILTER (WHERE a.status = 'cancelled')::INTEGER AS cancelled_approvals,
            COUNT(*) FILTER (WHERE a.approval_type = 'order_specific')::INTEGER AS order_specific_approvals,
            COUNT(*) FILTER (WHERE a.approval_type = 'verification_request')::INTEGER AS verification_request_approvals,
            COUNT(*) FILTER (WHERE a.verification_status = 'verified')::INTEGER AS verified_approvals,
            COUNT(*) FILTER (WHERE a.verification_status = 'customer_mismatch')::INTEGER AS mismatch_approvals
          FROM ticket_reply_approvals a
          INNER JOIN user_tickets ut ON ut.id = a.ticket_id
          WHERE a.user_id = $1
        )

        SELECT
          ticket_stats.*,
          message_stats.*,
          approval_stats.*
        FROM ticket_stats
        CROSS JOIN message_stats
        CROSS JOIN approval_stats
      `,
      [userId],
    );

    const overview = result.rows[0];

    return res.status(200).json({
      success: true,
      message: "Analytics overview fetched successfully",
      overview: {
        tickets: {
          total: overview.total_tickets,
          open: overview.open_tickets,
          in_progress: overview.in_progress_tickets,
          waiting_customer: overview.waiting_customer_tickets,
          resolved: overview.resolved_tickets,
          closed: overview.closed_tickets,
          demo: overview.demo_tickets,
          real: overview.real_tickets,
        },
        messages: {
          total: overview.total_messages,
          customer: overview.customer_messages,
          owner: overview.owner_messages,
        },
        replies: {
          total_approvals: overview.total_approvals,
          approved: overview.approved_approvals,
          sending: overview.sending_approvals,
          sent: overview.sent_approvals,
          cancelled: overview.cancelled_approvals,
          order_specific: overview.order_specific_approvals,
          verification_request: overview.verification_request_approvals,
        },
        verification: {
          verified: overview.verified_approvals,
          customer_mismatch: overview.mismatch_approvals,
        },
      },
    });
  } catch (error) {
    console.error("Analytics overview error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch analytics overview",
    });
  }
};

// ==========================================
// STORE-WISE PERFORMANCE ANALYTICS
// GET /api/analytics/stores
// ==========================================

export const getStoreWiseAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
        WITH store_tickets AS (
          SELECT
            s.id AS store_id,
            s.name AS store_name,
            t.id AS ticket_id,
            t.status,
            t.is_demo
          FROM stores s
          LEFT JOIN tickets t
            ON t.store_id = s.id
            AND t.user_id = s.user_id
          WHERE s.user_id = $1
        ),

        ticket_stats AS (
          SELECT
            store_id,
            store_name,

            COUNT(ticket_id)::INTEGER AS total_tickets,

            COUNT(ticket_id) FILTER (
              WHERE status = 'open'
            )::INTEGER AS open_tickets,

            COUNT(ticket_id) FILTER (
              WHERE status = 'in_progress'
            )::INTEGER AS in_progress_tickets,

            COUNT(ticket_id) FILTER (
              WHERE status = 'waiting_customer'
            )::INTEGER AS waiting_customer_tickets,

            COUNT(ticket_id) FILTER (
              WHERE status = 'resolved'
            )::INTEGER AS resolved_tickets,

            COUNT(ticket_id) FILTER (
              WHERE status = 'closed'
            )::INTEGER AS closed_tickets,

            COUNT(ticket_id) FILTER (
              WHERE is_demo = TRUE
            )::INTEGER AS demo_tickets,

            COUNT(ticket_id) FILTER (
              WHERE is_demo = FALSE
            )::INTEGER AS real_tickets

          FROM store_tickets
          GROUP BY store_id, store_name
        ),

        message_stats AS (
          SELECT
            st.store_id,

            COUNT(tm.id)::INTEGER AS total_messages,

            COUNT(tm.id) FILTER (
              WHERE tm.sender_type = 'customer'
            )::INTEGER AS customer_messages,

            COUNT(tm.id) FILTER (
              WHERE tm.sender_type = 'owner'
            )::INTEGER AS owner_messages

          FROM store_tickets st
          LEFT JOIN ticket_messages tm
            ON tm.ticket_id = st.ticket_id
          GROUP BY st.store_id
        ),

        approval_stats AS (
          SELECT
            st.store_id,

            COUNT(a.id)::INTEGER AS total_approvals,

            COUNT(a.id) FILTER (
              WHERE a.status = 'approved'
            )::INTEGER AS approved_approvals,

            COUNT(a.id) FILTER (
              WHERE a.status = 'sending'
            )::INTEGER AS sending_approvals,

            COUNT(a.id) FILTER (
              WHERE a.status = 'sent'
            )::INTEGER AS sent_approvals,

            COUNT(a.id) FILTER (
              WHERE a.status = 'cancelled'
            )::INTEGER AS cancelled_approvals,

            COUNT(a.id) FILTER (
              WHERE a.approval_type = 'order_specific'
            )::INTEGER AS order_specific_approvals,

            COUNT(a.id) FILTER (
              WHERE a.approval_type = 'verification_request'
            )::INTEGER AS verification_request_approvals,

            COUNT(a.id) FILTER (
              WHERE a.verification_status = 'verified'
            )::INTEGER AS verified_approvals,

            COUNT(a.id) FILTER (
              WHERE a.verification_status = 'customer_mismatch'
            )::INTEGER AS mismatch_approvals

          FROM store_tickets st
          LEFT JOIN ticket_reply_approvals a
            ON a.ticket_id = st.ticket_id
            AND a.user_id = $1
          GROUP BY st.store_id
        )

        SELECT
          ts.store_id,
          ts.store_name,

          ts.total_tickets,
          ts.open_tickets,
          ts.in_progress_tickets,
          ts.waiting_customer_tickets,
          ts.resolved_tickets,
          ts.closed_tickets,
          ts.demo_tickets,
          ts.real_tickets,

          COALESCE(ms.total_messages, 0)::INTEGER AS total_messages,
          COALESCE(ms.customer_messages, 0)::INTEGER AS customer_messages,
          COALESCE(ms.owner_messages, 0)::INTEGER AS owner_messages,

          COALESCE(a.total_approvals, 0)::INTEGER AS total_approvals,
          COALESCE(a.approved_approvals, 0)::INTEGER AS approved_approvals,
          COALESCE(a.sending_approvals, 0)::INTEGER AS sending_approvals,
          COALESCE(a.sent_approvals, 0)::INTEGER AS sent_approvals,
          COALESCE(a.cancelled_approvals, 0)::INTEGER AS cancelled_approvals,
          COALESCE(a.order_specific_approvals, 0)::INTEGER AS order_specific_approvals,
          COALESCE(a.verification_request_approvals, 0)::INTEGER AS verification_request_approvals,
          COALESCE(a.verified_approvals, 0)::INTEGER AS verified_approvals,
          COALESCE(a.mismatch_approvals, 0)::INTEGER AS mismatch_approvals

        FROM ticket_stats ts
        LEFT JOIN message_stats ms ON ms.store_id = ts.store_id
        LEFT JOIN approval_stats a ON a.store_id = ts.store_id
        ORDER BY ts.total_tickets DESC, ts.store_name ASC
      `,
      [userId],
    );

    return res.status(200).json({
      success: true,
      message: "Store-wise analytics fetched successfully",
      totalStores: result.rows.length,
      stores: result.rows.map((store) => ({
        store_id: store.store_id,
        store_name: store.store_name,

        tickets: {
          total: store.total_tickets,
          open: store.open_tickets,
          in_progress: store.in_progress_tickets,
          waiting_customer: store.waiting_customer_tickets,
          resolved: store.resolved_tickets,
          closed: store.closed_tickets,
          demo: store.demo_tickets,
          real: store.real_tickets,
        },

        messages: {
          total: store.total_messages,
          customer: store.customer_messages,
          owner: store.owner_messages,
        },

        replies: {
          total_approvals: store.total_approvals,
          approved: store.approved_approvals,
          sending: store.sending_approvals,
          sent: store.sent_approvals,
          cancelled: store.cancelled_approvals,
          order_specific: store.order_specific_approvals,
          verification_request: store.verification_request_approvals,
        },

        verification: {
          verified: store.verified_approvals,
          customer_mismatch: store.mismatch_approvals,
        },
      })),
    });
  } catch (error) {
    console.error("Store-wise analytics error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch store-wise analytics",
    });
  }
};
