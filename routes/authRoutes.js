import express from "express";

import {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
} from "../controllers/authController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// ==========================================
// AUTHENTICATION
// ==========================================

router.post("/register", register);

router.post("/login", login);

// Forgot Password (Public)
router.post("/forgot-password", forgotPassword);

// Reset Password (Public, token required)
router.post("/reset-password", resetPassword);

// ==========================================
// PROFILE SETTINGS (Protected)
// ==========================================

router.get("/me", authMiddleware, getProfile);

router.put("/profile", authMiddleware, updateProfile);

router.put("/change-password", authMiddleware, changePassword);

export default router;
