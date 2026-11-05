import express from "express";

import {
  getReturns,
  createReturn,
  getReturnById,
  updateReturnStatus,
  updateRefundStatus,
} from "../controllers/returnController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getReturns);
router.post("/", createReturn);
router.get("/:id", getReturnById);
router.patch("/:id/status", updateReturnStatus);
router.patch("/:id/refund", updateRefundStatus);

export default router;
