import { Router } from "express";
import { getMenuEngineering } from "../controllers/menu-engineering.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(authenticate, requireRoles("Admin"));
router.get("/", getMenuEngineering);

export default router;
