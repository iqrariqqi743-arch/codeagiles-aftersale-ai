import express from "express";

import { authMiddleware } from "../middleware/authMiddleware.js";

import {
  getAISettings,
  updateAISettings,
  suggestTicketReply,
  analyzeTicket,
  generateTicketReply,
  getKnowledgeBase,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from "../controllers/aiController.js";

const router = express.Router();

// Protect all AI routes with JWT authentication
router.use(authMiddleware);

// AI Settings
router.get("/settings/:storeId", getAISettings);
router.put("/settings/:storeId", updateAISettings);

// AI Ticket Reply
router.post("/tickets/:ticketId/suggest", suggestTicketReply);

// AI Ticket Analysis
router.post("/tickets/:ticketId/analyze", analyzeTicket);

router.post("/tickets/:ticketId/generate-reply", generateTicketReply);

// Knowledge Base
router.get("/knowledge/:storeId", getKnowledgeBase);
router.post("/knowledge/:storeId", createKnowledgeBase);
router.put("/knowledge/:id", updateKnowledgeBase);
router.delete("/knowledge/:id", deleteKnowledgeBase);

export default router;
