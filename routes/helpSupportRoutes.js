import express from "express";

import { authMiddleware } from "../middleware/authMiddleware.js";

import {
  createHelpSupportTicket,
  getMyHelpSupportTickets,
  getAllHelpSupportTickets,
  getHelpSupportTicketById,
  sendHelpSupportMessage,
  updateHelpSupportTicketStatus,
} from "../controllers/helpSupportController.js";

const router = express.Router();

// Protect all Help & Support routes
router.use(authMiddleware);

// ==========================================
// USER HELP & SUPPORT ROUTES
// ==========================================

// Create support ticket
router.post("/tickets", createHelpSupportTicket);

// Get logged-in user's tickets
router.get("/tickets/my", getMyHelpSupportTickets);

// ==========================================
// ADMIN HELP & SUPPORT ROUTES
// ==========================================

// Get all support tickets (Admin only)
router.get("/admin/tickets", getAllHelpSupportTickets);

// Update ticket status (Admin only)
router.patch("/admin/tickets/:id/status", updateHelpSupportTicketStatus);

// ==========================================
// TICKET CONVERSATION ROUTES
// ==========================================

// Get ticket details and messages
router.get("/tickets/:id", getHelpSupportTicketById);

// Send message to ticket conversation
router.post("/tickets/:id/messages", sendHelpSupportMessage);

export default router;
