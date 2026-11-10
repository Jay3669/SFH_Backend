import { Router } from "express";
import { getPublicOrderMenu, issueTableQrToken, submitPublicOrder } from "../controllers/public-order.controller.js";
import { getReceipt, getReceiptPdf, submitReceiptFeedback } from "../controllers/public-receipt.controller.js";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware.js";

const router = Router();
router.get("/order/:token", getPublicOrderMenu);
router.post("/order/:token", submitPublicOrder);
router.get("/receipts/:token/pdf", getReceiptPdf);
router.get("/receipts/:token", getReceipt);
router.post("/receipts/:token/feedback", submitReceiptFeedback);
router.post("/pos/qr-codes", authenticate, requireAdmin, issueTableQrToken);

export default router;
