import { Router } from "express";
import { createPosSale, listRecentPosSales } from "../controllers/pos.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(authenticate, requireRoles("Admin", "Manager", "Employee"));
router.get("/sales", listRecentPosSales);
router.post("/sales", createPosSale);

export default router;