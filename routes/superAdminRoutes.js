import express from "express";

import {
  getSuperAdminDashboard,
  getSuperAdminMerchants,
  getSuperAdminStores,
} from "../controllers/superAdminController.js";

import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  deleteUser,
} from "../controllers/superAdminUsersController.js";

import {
  getAllSubscriptionPlans,
  createSubscriptionPlan,
  updateSubscriptionPlan,
  updateSubscriptionPlanStatus,
  deleteSubscriptionPlan,
} from "../controllers/superAdminSubscriptionController.js";

import {
  getPlanFeatures,
  updatePlanFeature,
} from "../controllers/superAdminPlanFeaturesController.js";

import {
  authMiddleware,
  superAdminMiddleware,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// ======================================
// SUPER ADMIN AUTHENTICATION
// ======================================

// All routes require valid JWT
router.use(authMiddleware);

// All routes require Super Admin role
router.use(superAdminMiddleware);

// ======================================
// SUPER ADMIN DASHBOARD
// GET /api/super-admin/dashboard
// ======================================

router.get("/dashboard", getSuperAdminDashboard);

// ======================================
// GET ALL MERCHANTS
// GET /api/super-admin/merchants
// ======================================

router.get("/merchants", getSuperAdminMerchants);

// ======================================
// GET ALL STORES
// GET /api/super-admin/stores
// ======================================

router.get("/stores", getSuperAdminStores);

// ======================================
// SUPER ADMIN USERS MANAGEMENT
// ======================================

// GET ALL USERS
// GET /api/super-admin/users

router.get("/users", getAllUsers);

// GET SINGLE USER
// GET /api/super-admin/users/:id

router.get("/users/:id", getUserById);

// CREATE NEW USER
// POST /api/super-admin/users

router.post("/users", createUser);

// UPDATE USER
// PUT /api/super-admin/users/:id

router.put("/users/:id", updateUser);

// ACTIVATE / DEACTIVATE USER
// PATCH /api/super-admin/users/:id/status

router.patch("/users/:id/status", updateUserStatus);

// DELETE USER
// DELETE /api/super-admin/users/:id

router.delete("/users/:id", deleteUser);

// ======================================
// EXPORT ROUTER
// ======================================

// ======================================
// SUPER ADMIN SUBSCRIPTION PLANS
// ======================================

router.get("/subscription-plans", getAllSubscriptionPlans);

router.post("/subscription-plans", createSubscriptionPlan);

router.put("/subscription-plans/:id", updateSubscriptionPlan);

router.patch("/subscription-plans/:id/status", updateSubscriptionPlanStatus);

router.delete("/subscription-plans/:id", deleteSubscriptionPlan);

router.get("/subscription-plans/:planId/features", getPlanFeatures);

router.put(
  "/subscription-plans/:planId/features/:featureKey",
  updatePlanFeature,
);

export default router;
