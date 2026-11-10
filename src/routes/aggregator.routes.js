import { Router } from "express";
import {
    acceptAggregatorOrder,
    assignAggregatorRider,
    fireAggregatorOrder,
    listAggregatorOrders,
    receiveAggregatorWebhook,
} from "../controllers/aggregator-order.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.post("/webhooks/:provider", receiveAggregatorWebhook);
router.use(authenticate, requireRoles("Admin", "Manager", "Employee"));
router.get("/orders", listAggregatorOrders);
router.patch("/orders/:id/accept", acceptAggregatorOrder);
router.patch("/orders/:id/rider", assignAggregatorRider);
router.post("/orders/:id/fire", fireAggregatorOrder);

export default router;
