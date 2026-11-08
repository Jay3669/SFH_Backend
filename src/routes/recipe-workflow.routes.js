import { Router } from "express";
import {
    addRecipeIngredient,
    cancelProduction,
    confirmProduction,
    createPreparationPlan,
    createProductionDraft,
    createRecipeDefinition,
    deactivateRecipe,
    deleteRecipeIngredient,
    getConsumptionSummary,
    getDailyConsumption,
    getMonthlyConsumption,
    getNextDayRequirements,
    getPreparationShortages,
    getProductionById,
    getPurchaseSuggestions,
    getRecipeInventoryItems,
    getRecipeById,
    getRecipeVersionById,
    getRecipeVersions,
    getRecipes,
    getWeeklyConsumption,
    listProductions,
    listRecipeIngredients,
    previewProduction,
    updateRecipeDefinition,
    updateRecipeIngredient,
} from "../controllers/recipe-workflow.controller.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const router = Router();
const authorizeRecipeWorkflow = [authenticate, requireRoles("Admin", "Manager")];

router.get("/recipes", ...authorizeRecipeWorkflow, getRecipes);
router.get("/inventory/recipe-items", ...authorizeRecipeWorkflow, getRecipeInventoryItems);
router.post("/recipes", ...authorizeRecipeWorkflow, createRecipeDefinition);
router.get("/recipes/:id/versions", ...authorizeRecipeWorkflow, getRecipeVersions);
router.get("/recipes/:id/versions/:versionNumber", ...authorizeRecipeWorkflow, getRecipeVersionById);
router.get("/recipes/:id", ...authorizeRecipeWorkflow, getRecipeById);
router.put("/recipes/:id", ...authorizeRecipeWorkflow, updateRecipeDefinition);
router.delete("/recipes/:id", ...authorizeRecipeWorkflow, deactivateRecipe);
router.get("/recipes/:recipeId/ingredients", ...authorizeRecipeWorkflow, listRecipeIngredients);
router.post("/recipes/:recipeId/ingredients", ...authorizeRecipeWorkflow, addRecipeIngredient);
router.put("/recipes/:recipeId/ingredients/:ingredientId", ...authorizeRecipeWorkflow, updateRecipeIngredient);
router.delete("/recipes/:recipeId/ingredients/:ingredientId", ...authorizeRecipeWorkflow, deleteRecipeIngredient);

router.post("/productions/preview", ...authorizeRecipeWorkflow, previewProduction);
router.post("/productions", ...authorizeRecipeWorkflow, createProductionDraft);
router.get("/productions", ...authorizeRecipeWorkflow, listProductions);
router.get("/productions/:id", ...authorizeRecipeWorkflow, getProductionById);
router.post("/productions/:id/confirm", ...authorizeRecipeWorkflow, confirmProduction);
router.post("/productions/:id/cancel", ...authorizeRecipeWorkflow, cancelProduction);

router.get("/inventory/consumption/daily", ...authorizeRecipeWorkflow, getDailyConsumption);
router.get("/inventory/consumption/weekly", ...authorizeRecipeWorkflow, getWeeklyConsumption);
router.get("/inventory/consumption/monthly", ...authorizeRecipeWorkflow, getMonthlyConsumption);
router.get("/inventory/consumption/summary", ...authorizeRecipeWorkflow, getConsumptionSummary);
router.post("/inventory/preparation-plan", ...authorizeRecipeWorkflow, createPreparationPlan);
router.get("/inventory/next-day-requirements", ...authorizeRecipeWorkflow, getNextDayRequirements);
router.get("/inventory/shortages", ...authorizeRecipeWorkflow, getPreparationShortages);
router.get("/inventory/purchase-suggestions", ...authorizeRecipeWorkflow, getPurchaseSuggestions);

export default router;