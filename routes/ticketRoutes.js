import express from "express";

import {
  getTickets,
  createTicket,
  getTicketById,
  updateTicketStatus,
  addTicketMessage,
  approveTicketReply,
  applyAITicketSuggestions,
} from "../controllers/ticketController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getTickets);
router.post("/", createTicket);
router.get("/:id", getTicketById);
router.patch("/:id/status", updateTicketStatus);

// Apply AI suggestions after owner confirmation
router.patch("/:id/apply-ai-suggestions", applyAITicketSuggestions);

// Approve AI-generated or manually edited reply
router.post("/:id/approve-reply", approveTicketReply);

// Send approved reply
router.post("/:id/messages", addTicketMessage);

export default router;
