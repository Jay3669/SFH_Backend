import { Router } from "express";
import {
    createMenuCategory,
    deleteMenuCategory,
    getMenuCategories,
    getMenuCategoryById,
    updateMenuCategory,
} from "../controllers/menu-category.controller.js";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware.js";

const router = Router();

router.get("/", getMenuCategories);
router.get("/:id", getMenuCategoryById);
router.post("/", authenticate, requireAdmin, createMenuCategory);
router.put("/:id", authenticate, requireAdmin, updateMenuCategory);
router.delete("/:id", authenticate, requireAdmin, deleteMenuCategory);

export default router;
