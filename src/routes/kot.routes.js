import { Router } from "express";
import { fireKot, listKitchenKots, updateKotItemStatus } from "../controllers/kot.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(authenticate, requireRoles("Admin", "Manager", "Employee"));
router.get("/", listKitchenKots);
router.post("/", fireKot);
router.patch("/:kotNumber/items/:kotItemId", updateKotItemStatus);

export default router;
