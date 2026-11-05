import express from "express";

import {
  addStore,
  getStores,
  deleteStore,
  connectWooCommerce,
  disconnectWooCommerce,
} from "../controllers/storeController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

// Existing routes
router.post("/", addStore);
router.get("/", getStores);
router.delete("/:id", deleteStore);

// WooCommerce integration routes
router.post("/:id/connect", connectWooCommerce);
router.post("/:id/disconnect", disconnectWooCommerce);

export default router;
