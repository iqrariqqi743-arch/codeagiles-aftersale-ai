import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";

import { createServer } from "http";
import { Server } from "socket.io";

import pool from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import storeRoutes from "./routes/storeRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import ticketRoutes from "./routes/ticketRoutes.js";
import returnRoutes from "./routes/returnRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import knowledgeBaseRoutes from "./routes/knowledgeBaseRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";

import { readCustomerReplies } from "./services/gmailImapService.js";

import helpSupportRoutes from "./routes/helpSupportRoutes.js";
import superAdminRoutes from "./routes/superAdminRoutes.js";
import superAdminSettingsRoutes from "./routes/superAdminSettingsRoutes.js";

// ======================================
// ENVIRONMENT CONFIGURATION
// ======================================

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 5000);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// ======================================
// HTTP SERVER
// ======================================

const httpServer = createServer(app);

// ======================================
// SOCKET.IO SERVER
// ======================================

export const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ======================================
// SECURITY MIDDLEWARES
// ======================================

app.disable("x-powered-by");

app.use(helmet());

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);

// ======================================
// STRIPE WEBHOOK BODY HANDLING
// ======================================

// Stripe signature verification requires the
// original raw request body.
//
// Keep express.raw() on the exact webhook route
// when its implementation is confirmed.
// Do not add global raw body parsing.

// ======================================
// JSON MIDDLEWARE
// ======================================

app.use(express.json({ limit: "1mb" }));

// ======================================
// SOCKET.IO CONNECTION
// ======================================

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", socket.id, reason);
  });
});

// ======================================
// HOME API
// ======================================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to CodeAgiles AfterSale AI API",
    environment: process.env.NODE_ENV || "development",
  });
});

// ======================================
// POSTGRESQL HEALTH CHECK
// ======================================

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS server_time");

    return res.status(200).json({
      success: true,
      message: "Node.js and PostgreSQL connected successfully",
      database: "connected",
      serverTime: result.rows[0].server_time,
    });
  } catch (error) {
    console.error("Database connection failed:", error.message);

    return res.status(503).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// ======================================
// API ROUTES
// ======================================

app.use("/api/auth", authRoutes);

app.use("/api/stores", storeRoutes);

app.use("/api/orders", orderRoutes);

app.use("/api/tickets", ticketRoutes);

app.use("/api/returns", returnRoutes);

app.use("/api/ai", aiRoutes);

app.use("/api/knowledge-base", knowledgeBaseRoutes);

app.use("/api/analytics", analyticsRoutes);

app.use("/api/subscriptions", subscriptionRoutes);

app.use("/api/help-support", helpSupportRoutes);

app.use("/api/super-admin", superAdminRoutes);

app.use("/api/super-admin/settings", superAdminSettingsRoutes);

// ======================================
// AUTOMATIC GMAIL SYNC
// ======================================

let gmailSyncRunning = false;

const syncGmailReplies = async () => {
  if (gmailSyncRunning) {
    console.log("Gmail sync already running. Skipping...");
    return;
  }

  gmailSyncRunning = true;

  try {
    console.log("--------------------------------");
    console.log("Starting automatic Gmail sync...");

    const results = await readCustomerReplies();

    const newReplies = results.filter((reply) => reply.saved === true);

    console.log(`Gmail Sync: ${newReplies.length} new customer replies`);

    // Customer messages must not be
    // broadcast globally through Socket.IO.

    console.log("Automatic Gmail sync completed.");
    console.log("--------------------------------");
  } catch (error) {
    console.error("Automatic Gmail sync failed:", error.message);
  } finally {
    gmailSyncRunning = false;
  }
};

// ======================================
// GMAIL SYNC CONFIGURATION
// ======================================

const GMAIL_SYNC_INTERVAL = Number(process.env.GMAIL_SYNC_INTERVAL || 15000);

const ENABLE_GMAIL_SYNC = process.env.ENABLE_GMAIL_SYNC !== "false";

let gmailSyncInterval = null;

// ======================================
// START GMAIL SYNC
// ======================================

const startGmailSync = () => {
  if (!ENABLE_GMAIL_SYNC) {
    console.log("Automatic Gmail synchronization disabled");
    return;
  }

  if (!Number.isFinite(GMAIL_SYNC_INTERVAL) || GMAIL_SYNC_INTERVAL < 1000) {
    console.error("Invalid GMAIL_SYNC_INTERVAL. Gmail sync disabled.");
    return;
  }

  console.log("Automatic Gmail synchronization enabled");

  console.log(`Gmail check interval: ${GMAIL_SYNC_INTERVAL}ms`);

  syncGmailReplies();

  gmailSyncInterval = setInterval(syncGmailReplies, GMAIL_SYNC_INTERVAL);
};

// ======================================
// START SERVER
// ======================================

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("--------------------------------");
  console.log("CodeAgiles AfterSale AI Backend");
  console.log(`Port: ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Health: /api/health`);
  console.log("Socket.IO server initialized");
  console.log("--------------------------------");

  startGmailSync();
});

// ======================================
// GRACEFUL SHUTDOWN
// ======================================

let isShuttingDown = false;

const shutdown = (signal) => {
  if (isShuttingDown) return;

  isShuttingDown = true;

  console.log(`Received ${signal}`);
  console.log("Shutting down server...");

  if (gmailSyncInterval) {
    clearInterval(gmailSyncInterval);
    gmailSyncInterval = null;
  }

  httpServer.close(async () => {
    console.log("HTTP server closed.");

    try {
      await pool.end();
      console.log("PostgreSQL pool closed.");
      process.exit(0);
    } catch (error) {
      console.error("Shutdown error:", error.message);
      process.exit(1);
    }
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
