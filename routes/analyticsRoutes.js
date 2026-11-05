import express from "express";

import {
  getAnalyticsOverview,
  getStoreWiseAnalytics,
} from "../controllers/analyticsController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// Protect all analytics routes
router.use(authMiddleware);

// Analytics Overview
router.get("/overview", getAnalyticsOverview);
router.get("/stores", getStoreWiseAnalytics);

export default router;
