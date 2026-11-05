import express from "express";

import {
  getKnowledgeBase,
  getKnowledgeBaseById,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  testKnowledgeBase,
} from "../controllers/knowledgeBaseController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Knowledge Base CRUD
router.get("/", getKnowledgeBase);
router.post("/", createKnowledgeBase);
router.get("/:id", getKnowledgeBaseById);
router.put("/:id", updateKnowledgeBase);
router.delete("/:id", deleteKnowledgeBase);

// AI Knowledge Base Playground
router.post("/test", testKnowledgeBase);

export default router;
