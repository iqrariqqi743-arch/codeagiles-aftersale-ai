import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import crypto from "node:crypto";
import pool from "../config/db.js";

// ======================================
// GLOBAL SYNC STATE
// ======================================

let isGmailSyncRunning = false;

// ======================================
// HELPERS
// ======================================

const normalizeEmail = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase();
};

const isConnectionError = (error) => {
  const codes = [
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EPIPE",
  ];

  return codes.includes(error?.code);
};

// ======================================
// CLEAN CUSTOMER EMAIL REPLY
// ======================================

const cleanEmailReply = (text) => {
  let message = String(text || "")
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!message) return "";

  const quotedPatterns = [
    /^On .+wrote:\s*$/im,
    /^On [^\n]+\n(?:[^\n]*\n){0,4}?[^\n]*wrote:\s*$/im,
    /^-{2,}\s*Original Message\s*-{2,}/im,
    /^-{2,}\s*Forwarded message\s*-{2,}/im,
    /^Begin forwarded message:/im,
    /^From:\s*.+$/im,
  ];

  let cutIndex = message.length;

  for (const pattern of quotedPatterns) {
    const match = pattern.exec(message);

    if (match && match.index < cutIndex) {
      cutIndex = match.index;
    }
  }

  message = message.slice(0, cutIndex);

  message = message
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");

  message = message.split(/\n--\s*\n/)[0];

  const lines = message.split("\n");

  const signaturePatterns = [
    /^sent from my (iphone|ipad|android)/i,
    /^get outlook for/i,
    /^best regards,?\s*$/i,
    /^kind regards,?\s*$/i,
    /^warm regards,?\s*$/i,
    /^regards,?\s*$/i,
    /^sincerely,?\s*$/i,
    /^thanks and regards,?\s*$/i,
  ];

  let signatureIndex = -1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();

    if (signaturePatterns.some((pattern) => pattern.test(line))) {
      signatureIndex = i;
      break;
    }
  }

  if (signatureIndex !== -1) {
    message = lines.slice(0, signatureIndex).join("\n");
  } else {
    const businessMarkers = [
      /^(proprietor|director|manager|ceo|founder|owner)$/i,
      /^(mobile|phone|tel|telephone|skype)\s*[:#]/i,
      /^(exporter|importer|freight forwarding)/i,
    ];

    const blocks = message.split(/\n\s*\n/);

    for (let i = 1; i < blocks.length; i++) {
      const blockLines = blocks[i]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const markerCount = blockLines.filter((line) =>
        businessMarkers.some((pattern) => pattern.test(line)),
      ).length;

      if (markerCount >= 2) {
        message = blocks.slice(0, i).join("\n\n");

        break;
      }
    }
  }

  return message.replace(/\n{3,}/g, "\n\n").trim();
};

// ======================================
// CREATE GMAIL CLIENT
// ======================================

const createGmailClient = () => {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,

    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },

    logger: false,

    connectionTimeout: 30000,
    greetingTimeout: 15000,
    socketTimeout: 120000,
  });

  // IMPORTANT: Prevent unhandled error crash
  client.on("error", (error) => {
    console.error("Gmail IMAP connection error:", error.message);

    if (isConnectionError(error)) {
      console.warn("Gmail connection interrupted. Next sync can retry.");
    }
  });

  client.on("close", () => {
    console.log("Gmail IMAP connection closed.");
  });

  return client;
};

// ======================================
// SAFE DISCONNECT
// ======================================

const safeDisconnect = async (client) => {
  if (!client) return;

  try {
    if (client.usable) {
      await Promise.race([
        client.logout(),

        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Logout timeout")), 5000),
        ),
      ]);
    }
  } catch (error) {
    console.warn("Gmail logout warning:", error.message);
  } finally {
    try {
      client.close();
    } catch (error) {
      console.warn("Gmail close warning:", error.message);
    }
  }
};

// ======================================
// TEST GMAIL CONNECTION
// ======================================

export const testGmailConnection = async () => {
  const client = createGmailClient();

  try {
    await client.connect();

    console.log("Gmail IMAP connected successfully!");

    const mailbox = await client.mailboxOpen("INBOX");

    console.log("Total inbox messages:", mailbox.exists);

    return true;
  } catch (error) {
    console.error("Gmail IMAP connection failed:", error.message);

    return false;
  } finally {
    await safeDisconnect(client);
  }
};

// ======================================
// EXTRACT TICKET NUMBER
// ======================================

const extractTicketNumber = (subject) => {
  const match = String(subject || "").match(/TKT-[A-F0-9]{16}/i);

  return match ? match[0].toUpperCase() : null;
};

// ======================================
// SAVE CUSTOMER EMAIL TO TICKET
// ======================================

const saveCustomerReply = async ({
  ticketNumber,
  sender,
  message,
  messageId,
  receivedAt,
}) => {
  const dbClient = await pool.connect();

  let transactionStarted = false;

  try {
    await dbClient.query("BEGIN");
    transactionStarted = true;

    // ======================================
    // FIND TICKET AND VERIFY CUSTOMER
    // ======================================

    const ticketResult = await dbClient.query(
      `
      SELECT
        id,
        user_id,
        ticket_number,
        customer_email
      FROM tickets
      WHERE ticket_number = $1
        AND LOWER(TRIM(customer_email)) = $2
      LIMIT 1
      `,
      [ticketNumber, normalizeEmail(sender)],
    );

    if (ticketResult.rows.length === 0) {
      await dbClient.query("ROLLBACK");
      transactionStarted = false;

      console.log(
        "SKIPPED: Ticket not found or customer email mismatch:",
        ticketNumber,
        sender,
      );

      return {
        saved: false,
        reason: "ticket_or_customer_mismatch",
      };
    }

    const ticket = ticketResult.rows[0];

    // ======================================
    // DUPLICATE EMAIL PROTECTION
    // ======================================

    const incomingResult = await dbClient.query(
      `
      INSERT INTO ticket_incoming_emails (
        ticket_id,
        message_id,
        sender_email,
        received_at
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (message_id) DO NOTHING
      RETURNING id
      `,
      [ticket.id, messageId, normalizeEmail(sender), receivedAt || null],
    );

    if (incomingResult.rows.length === 0) {
      await dbClient.query("ROLLBACK");
      transactionStarted = false;

      console.log("SKIPPED: Email already imported:", messageId);

      return {
        saved: false,
        reason: "duplicate",
      };
    }

    // ======================================
    // SAVE CUSTOMER REPLY
    // ======================================

    const savedMessage = await dbClient.query(
      `
      INSERT INTO ticket_messages (
        ticket_id,
        sender_type,
        message
      )
      VALUES ($1, 'customer', $2)
      RETURNING *
      `,
      [ticket.id, message],
    );

    // ======================================
    // UPDATE TICKET TIMESTAMP
    // ======================================

    await dbClient.query(
      `
      UPDATE tickets
      SET updated_at = NOW()
      WHERE id = $1
      `,
      [ticket.id],
    );

    await dbClient.query("COMMIT");
    transactionStarted = false;

    console.log("CUSTOMER REPLY SAVED SUCCESSFULLY!");

    console.log("Ticket:", ticket.ticket_number);

    console.log("Customer:", sender);

    console.log("Message ID:", savedMessage.rows[0].id);

    return {
      saved: true,
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      message: savedMessage.rows[0],
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await dbClient.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError.message);
      }
    }

    throw error;
  } finally {
    dbClient.release();
  }
};

// ======================================
// READ CUSTOMER REPLIES
// ======================================

export const readCustomerReplies = async () => {
  // ======================================
  // PREVENT MULTIPLE SIMULTANEOUS SYNCS
  // ======================================

  if (isGmailSyncRunning) {
    console.log("Gmail sync already running. Skipping...");

    return [];
  }

  isGmailSyncRunning = true;

  const client = createGmailClient();

  const results = [];

  try {
    // ======================================
    // CONNECT TO GMAIL
    // ======================================

    await client.connect();

    console.log("\n==================================");

    console.log("GMAIL IMAP CONNECTED");

    console.log("==================================");

    const mailbox = await client.mailboxOpen("INBOX");

    console.log("Total inbox messages:", mailbox.exists);

    if (mailbox.exists === 0) {
      console.log("Inbox is empty.");
      return [];
    }

    const supportEmail = normalizeEmail(process.env.SMTP_USER);

    // ======================================
    // SCAN LATEST 100 EMAILS
    // ======================================

    const start = Math.max(1, mailbox.exists - 99);

    console.log("Scanning latest 100 emails...");

    for await (const email of client.fetch(`${start}:*`, {
      uid: true,
      envelope: true,
      source: true,
    })) {
      try {
        // ======================================
        // GET EMAIL SUBJECT
        // ======================================

        const subject = email.envelope?.subject || "";

        const ticketNumber = extractTicketNumber(subject);

        if (!ticketNumber) {
          continue;
        }

        // ======================================
        // PARSE EMAIL
        // ======================================

        const parsed = await simpleParser(email.source);

        const sender = normalizeEmail(parsed.from?.value?.[0]?.address);

        // ======================================
        // IGNORE SUPPORT EMAIL
        // ======================================

        if (!sender || sender === supportEmail) {
          console.log("SKIPPED: Support email or missing sender:", sender);

          continue;
        }

        // ======================================
        // CLEAN EMAIL MESSAGE
        // ======================================

        const message = cleanEmailReply(parsed.text);

        if (!message) {
          console.log("SKIPPED: Empty email body.");

          continue;
        }

        // ======================================
        // MESSAGE LENGTH VALIDATION
        // ======================================

        if (message.length > 10000) {
          console.log("SKIPPED: Email body exceeds 10000 characters.");

          continue;
        }

        // ======================================
        // UNIQUE EMAIL MESSAGE ID
        // ======================================

        const messageId =
          parsed.messageId?.trim() ||
          crypto
            .createHash("sha256")
            .update(`${supportEmail}:${mailbox.uidValidity}:${email.uid}`)
            .digest("hex");

        console.log("----------------------------------");

        console.log("Ticket:", ticketNumber);
        console.log("From:", sender);
        console.log("Subject:", subject);

        console.log("Clean Message:", message);

        // ======================================
        // SAVE CUSTOMER REPLY
        // ======================================

        const result = await saveCustomerReply({
          ticketNumber,
          sender,
          message,
          messageId,
          receivedAt: parsed.date,
        });

        results.push({
          ticketNumber,
          sender,
          ...result,
        });
      } catch (emailError) {
        console.error(
          "Failed processing individual email:",
          emailError.message,
        );

        // Stop scanning if connection was lost.
        // Next scheduled sync can reconnect.
        if (isConnectionError(emailError) || !client.usable) {
          console.warn("Gmail connection lost during scan.");

          break;
        }
      }
    }

    // ======================================
    // SCAN COMPLETED
    // ======================================

    console.log("\n==================================");

    console.log("GMAIL SCAN COMPLETED");

    console.log("==================================");

    console.log(
      "Customer replies saved:",
      results.filter((item) => item.saved).length,
    );

    return results;
  } catch (error) {
    console.error("Error reading customer replies:", error.message);

    if (isConnectionError(error)) {
      console.warn("Temporary Gmail connection failure.");

      console.warn("Backend will continue running. Next sync can retry.");

      return results;
    }

    // Preserve existing error behavior for
    // unexpected failures.
    throw error;
  } finally {
    // ======================================
    // SAFE CLEANUP
    // ======================================

    try {
      await safeDisconnect(client);
    } finally {
      isGmailSyncRunning = false;

      console.log("Gmail sync lock released.");
    }
  }
};
