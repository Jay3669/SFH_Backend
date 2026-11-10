import { Router } from "express";
import { getKitchenAnalytics } from "../controllers/kitchen-analytics.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(authenticate, requireRoles("Admin", "Manager"));
router.get("/", getKitchenAnalytics);

export default router;
