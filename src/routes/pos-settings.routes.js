import { Router } from "express";
import { getPosSettings, updatePosSettings } from "../controllers/pos-settings.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(authenticate, requireRoles("Admin", "Manager", "Employee"));
router.get("/", getPosSettings);
router.put("/", requireRoles("Admin", "Manager"), updatePosSettings);

export default router;