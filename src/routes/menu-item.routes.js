import { Router } from "express";
import {
    createMenuItem,
    deleteMenuItem,
    getMenuItemById,
    getMenuItems,
    updateMenuItem,
} from "../controllers/menu-item.controller.js";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware.js";

const router = Router();

router.get("/", getMenuItems);
router.get("/:id", getMenuItemById);
router.post("/", authenticate, requireAdmin, createMenuItem);
router.put("/:id", authenticate, requireAdmin, updateMenuItem);
router.delete("/:id", authenticate, requireAdmin, deleteMenuItem);

export default router;
