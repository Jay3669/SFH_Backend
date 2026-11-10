import { Router } from "express";
import {
    addCashDrawerMovement,
    closeCashDrawer,
    handoverCashDrawer,
    listCashierOptions,
    listCashDrawers,
    openCashDrawer,
} from "../controllers/cash-drawer.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(authenticate, requireRoles("Admin", "Manager", "Employee"));
router.get("/", listCashDrawers);
router.get("/cashiers", listCashierOptions);
router.post("/", openCashDrawer);
router.post("/:drawerId/movements", addCashDrawerMovement);
router.post("/:drawerId/close", closeCashDrawer);
router.post("/:drawerId/handover", handoverCashDrawer);

export default router;
