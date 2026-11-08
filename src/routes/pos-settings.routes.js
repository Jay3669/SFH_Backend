import { Router } from "express";
import { getPosSettings, updatePosSettings } from "../controllers/pos-settings.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(authenticate, requireRoles("Admin", "Manager"));
router.get("/", getPosSettings);
router.put("/", updatePosSettings);

export default router;