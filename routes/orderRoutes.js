import express from "express";

import {
  getOrders,
  createDemoOrders,
  syncWooCommerceOrders,
} from "../controllers/orderController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getOrders);
router.post("/demo", createDemoOrders);

// SYNC WOOCOMMERCE ORDERS
router.post("/sync-woocommerce", syncWooCommerceOrders);

export default router;
