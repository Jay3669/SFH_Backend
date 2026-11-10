import { Router } from "express";
import { createPosSale, listRecentPosSales, resendWhatsAppBill, setManagerPin } from "../controllers/pos.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(authenticate, requireRoles("Admin", "Manager", "Employee"));
router.get("/sales", listRecentPosSales);
router.post("/sales", createPosSale);
router.post("/sales/:saleId/whatsapp", resendWhatsAppBill);
router.post("/discount-authorizations/pin", setManagerPin);

export default router;