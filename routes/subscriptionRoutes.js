
import express from "express";

import {
  getSubscriptionPlans,
  getMySubscription,
} from "../controllers/subscriptionController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public route - anyone can view plans
router.get("/plans", getSubscriptionPlans);

// Protected routes - login required
router.use(authMiddleware);

router.get("/me", getMySubscription);

export default router;
