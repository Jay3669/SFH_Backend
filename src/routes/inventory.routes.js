import { Router } from "express";
import {
    cancelPurchase,
    completePosSale,
    createCategory,
    createItem,
    createPurchase,
    createRecipe,
    createSupplier,
    deleteCategory,
    deleteRecipe,
    deleteSupplier,
    getInventory,
    getInventoryReport,
    getCategories,
    getCategoryById,
    receivePurchase,
    recordMovement,
    recordPurchasePayment,
    setSupplierActive,
    updateBatchExpiry,
    updateCategory,
    updateItem,
    updateRecipe,
    updateSupplier,
} from "../controllers/inventory.controller.js";
import { getBillingReport } from "../controllers/billing-report.controller.js";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(authenticate, requireAdmin);

router.get("/", getInventory);
router.get("/reports", getInventoryReport);
router.get("/reports/billing", getBillingReport);
router.get("/categories", getCategories);
router.get("/categories/:id", getCategoryById);
router.post("/categories", createCategory);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);
router.post("/items", createItem);
router.put("/items/:id", updateItem);
router.post("/items/:id/movements", recordMovement);
router.put("/items/:id/batches/:batchCode", updateBatchExpiry);
router.post("/suppliers", createSupplier);
router.put("/suppliers/:id", updateSupplier);
router.patch("/suppliers/:id/status", setSupplierActive);
router.delete("/suppliers/:id", deleteSupplier);
router.post("/purchases", createPurchase);
router.post("/purchases/:id/receive", receivePurchase);
router.post("/purchases/:id/cancel", cancelPurchase);
router.post("/purchases/:id/payments", recordPurchasePayment);
router.post("/recipes", createRecipe);
router.put("/recipes/:id", updateRecipe);
router.delete("/recipes/:id", deleteRecipe);
router.post("/pos/sales", completePosSale);

export default router;
