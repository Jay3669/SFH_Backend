import { Router } from "express";
import {
    createPromotion,
    deletePromotion,
    getActivePromotions,
    getPromotions,
    updatePromotion,
} from "../controllers/promotion.controller.js";
import { authenticate, requireAdmin, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.get("/active", authenticate, requireRoles("Admin", "Manager", "Employee"), getActivePromotions);
router.use(authenticate, requireAdmin);
router.get("/", getPromotions);
router.post("/", createPromotion);
router.put("/:id", updatePromotion);
router.delete("/:id", deletePromotion);

export default router;
