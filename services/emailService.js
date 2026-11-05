import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE !== "false",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

const escapeHtml = (value = "") => {
  return String(value).replace(/[&<>"']/g, (char) => {
    const chars = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return chars[char];
  });
};

export const sendTicketReplyEmail = async ({
  customerEmail,
  customerName,
  ticketNumber,
  storeName,
  reply,
}) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error("SMTP credentials are not configured");
  }

  if (!customerEmail || !reply?.trim()) {
    throw new Error("Customer email and reply are required");
  }

  const safeName = escapeHtml(customerName || "Customer");
  const safeTicket = escapeHtml(ticketNumber || "");
  const safeStore = escapeHtml(storeName || "Support Team");
  const safeReply = escapeHtml(reply).replace(/\n/g, "<br />");

  const info = await transporter.sendMail({
    from: {
      name: process.env.SMTP_FROM_NAME || "CodeAgiles AfterSale AI",
      address: process.env.SMTP_USER,
    },

    to: customerEmail,

    subject: `Support Ticket ${ticketNumber} - New Reply`,

    text: `Hello ${customerName || "Customer"},

You have received a new reply regarding ticket ${ticketNumber}.

${reply}

Regards,
${storeName || "Support Team"}`,

    html: `
      <div style="background:#f4f6fb;padding:30px;font-family:Arial,sans-serif;">
        <div style="max-width:600px;margin:auto;background:white;border-radius:12px;overflow:hidden;">

          <div style="background:#111827;color:white;padding:24px;">
            <h2 style="margin:0;">${safeStore}</h2>
            <p style="margin:8px 0 0;">Customer Support</p>
          </div>

          <div style="padding:30px;color:#374151;">
            <h3>Hello ${safeName},</h3>

            <p>
              Our support team has replied to your ticket.
            </p>

            <p>
              <strong>Ticket:</strong> ${safeTicket}
            </p>

            <div style="background:#f9fafb;border-left:4px solid #6366f1;padding:18px;margin:20px 0;line-height:1.7;">
              ${safeReply}
            </div>

            <p>Thank you for contacting us.</p>

            <p>
              Regards,<br />
              <strong>${safeStore}</strong>
            </p>
          </div>

          <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280;">
            Powered by CodeAgiles AfterSale AI
          </div>

        </div>
      </div>
    `,
  });

  return {
    success: true,
    messageId: info.messageId,
  };
};
