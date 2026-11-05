import express from "express";

import {
  getSuperAdminSettings,
  updateSuperAdminSettings,
} from "../controllers/superAdminSettingsController.js";

import {
  authMiddleware,
  superAdminMiddleware,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// ==========================================
// SUPER ADMIN AUTHENTICATION
// ==========================================

router.use(authMiddleware);
router.use(superAdminMiddleware);

// ==========================================
// GET ALL SETTINGS
// GET /api/super-admin/settings
// ==========================================

router.get("/", getSuperAdminSettings);

// ==========================================
// UPDATE SETTINGS
// PUT /api/super-admin/settings
// ==========================================

router.put("/", updateSuperAdminSettings);

export default router;
