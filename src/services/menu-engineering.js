import { Op } from "sequelize";
import InventoryBatch from "../models/inventory-batch.model.js";
import InventoryItem from "../models/inventory-item.model.js";
import InventoryMenuRecipe from "../models/inventory-menu-recipe.model.js";
import InventoryMenuRecipeIngredient from "../models/inventory-menu-recipe-ingredient.model.js";
import InventoryMenuRecipeVersion from "../models/inventory-menu-recipe-version.model.js";
import InventoryRecipe from "../models/inventory-recipe.model.js";
import PosSale from "../models/pos-sale.model.js";
import PosSaleItem from "../models/pos-sale-item.model.js";
import { calculateMenuEngineering } from "./menu-engineering-calculations.js";

const MAX_SALES = 10000;
const MAX_SALE_ITEMS = 100000;

function weightedUnitCost(batches, fallback) {
    let quantity = 0;
    let value = 0;
    let hasMissingBatchCost = false;
    for (const batch of batches) {
        const batchQuantity = Number(batch.quantity);
        const unitCost = Number(batch.unit_cost);
        if (batchQuantity > 0 && Number.isFinite(batchQuantity)) {
            quantity += batchQuantity;
            if (unitCost > 0 && Number.isFinite(unitCost)) value += batchQuantity * unitCost;
            else hasMissingBatchCost = true;
        }
    }
    if (quantity > 0 && !hasMissingBatchCost) return value / quantity;
    const itemCost = Number(fallback);
    return Number.isFinite(itemCost) && itemCost > 0 ? itemCost : null;
}

function makeIngredientCostMap(items, batches) {
    const batchesByItem = new Map();
    for (const batch of batches) {
        const key = String(batch.item_id);
        if (!batchesByItem.has(key)) batchesByItem.set(key, []);
        batchesByItem.get(key).push(batch);
    }
    return new Map(items.map((item) => [
        String(item.inventory_item_id),
        weightedUnitCost(batchesByItem.get(String(item.inventory_item_id)) || [], item.unit_cost),
    ]));
}

function calculateRecipeCost(ingredients, ingredientCosts, quantityForServing) {
    const missingIngredients = [];
    let cost = 0;
    for (const ingredient of ingredients) {
        const itemId = String(ingredient.item_id);
        const currentUnitCost = ingredientCosts.get(itemId);
        const snapshotUnitCost = Number(ingredient.unit_cost_snapshot);
        const unitCost = Number.isFinite(currentUnitCost)
            ? currentUnitCost
            : Number.isFinite(snapshotUnitCost) && snapshotUnitCost > 0
                ? snapshotUnitCost
                : null;
        const quantity = Number(ingredient.quantity_per_serving ?? ingredient.quantity);
        if (!Number.isFinite(unitCost) || !Number.isFinite(quantity) || quantity <= 0) {
            missingIngredients.push(ingredient.item_name || `Ingredient ${itemId}`);
            continue;
        }
        cost += (quantity / (quantityForServing || 1)) * unitCost;
    }
    return missingIngredients.length ? { cost: null, missingIngredients } : { cost, missingIngredients: [] };
}

export async function getMenuEngineeringAnalytics(days, now = new Date()) {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const sales = await PosSale.findAll({
        where: { status: "Paid", completed_at: { [Op.gte]: since } },
        attributes: [
            "pos_sale_id",
            "amount_paid",
            "total_amount",
            "balance_due",
            "subtotal",
            "discount_amount",
            "completed_at",
        ],
        order: [["completed_at", "DESC"]],
        limit: MAX_SALES,
    });
    const paidSales = sales.filter((sale) =>
        Number(sale.amount_paid) >= Number(sale.total_amount) && Number(sale.balance_due) <= 0);
    const saleIds = paidSales.map((sale) => sale.pos_sale_id);
    const paidSalesById = new Map(paidSales.map((sale) => [String(sale.pos_sale_id), sale]));
    const saleItems = saleIds.length
        ? await PosSaleItem.findAll({
            where: { sale_id: { [Op.in]: saleIds } },
            attributes: ["sale_id", "menu_item_id", "item_name", "quantity", "line_total"],
            order: [["pos_sale_item_id", "ASC"]],
            limit: MAX_SALE_ITEMS,
        })
        : [];

    const grouped = new Map();
    for (const item of saleItems) {
        const quantity = Number(item.quantity);
        const lineTotal = Number(item.line_total);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        const key = item.menu_item_id ? `menu:${item.menu_item_id}` : `name:${item.item_name.toLocaleLowerCase()}`;
        const row = grouped.get(key) || {
            key,
            menuItemId: item.menu_item_id ? String(item.menu_item_id) : null,
            dishName: item.item_name,
            soldQuantity: 0,
            netSales: 0,
        };
        row.soldQuantity += quantity;
        const sale = paidSalesById.get(String(item.sale_id));
        const subtotal = Number(sale?.subtotal);
        const discount = Number(sale?.discount_amount);
        const discountRate = subtotal > 0 && Number.isFinite(discount)
            ? Math.min(1, Math.max(0, discount / subtotal))
            : 0;
        row.netSales += Number.isFinite(lineTotal) ? lineTotal * (1 - discountRate) : 0;
        grouped.set(key, row);
    }
    const dishes = [...grouped.values()];
    const menuItemIds = [...new Set(dishes.filter((dish) => dish.menuItemId).map((dish) => dish.menuItemId))];
    const dishNames = [...new Set(dishes.map((dish) => dish.dishName))];

    const activeRecipes = menuItemIds.length
        ? await InventoryMenuRecipe.findAll({
            where: { menu_item_id: { [Op.in]: menuItemIds }, status: "Active" },
            attributes: ["inventory_menu_recipe_id", "menu_item_id", "current_version", "updatedAt"],
            order: [["updatedAt", "DESC"], ["inventory_menu_recipe_id", "DESC"]],
        })
        : [];
    const recipeByMenuItem = new Map();
    for (const recipe of activeRecipes) {
        const key = String(recipe.menu_item_id);
        if (!recipeByMenuItem.has(key)) recipeByMenuItem.set(key, recipe);
    }

    const currentRecipes = [...recipeByMenuItem.values()];
    const versions = currentRecipes.length
        ? await InventoryMenuRecipeVersion.findAll({
            where: {
                recipe_id: { [Op.in]: currentRecipes.map((recipe) => recipe.inventory_menu_recipe_id) },
            },
            attributes: ["inventory_menu_recipe_version_id", "recipe_id", "version_number", "base_production_quantity"],
        })
        : [];
    const currentVersionNumbers = new Map(currentRecipes.map((recipe) => [
        String(recipe.inventory_menu_recipe_id),
        Number(recipe.current_version),
    ]));
    const versionByRecipe = new Map(versions
        .filter((version) => Number(version.version_number) === currentVersionNumbers.get(String(version.recipe_id)))
        .map((version) => [String(version.recipe_id), version]));
    const versionIds = versions.map((version) => version.inventory_menu_recipe_version_id);
    const currentIngredients = versionIds.length
        ? await InventoryMenuRecipeIngredient.findAll({
            where: { recipe_version_id: { [Op.in]: versionIds } },
            attributes: ["recipe_version_id", "item_id", "quantity", "unit_cost_snapshot"],
        })
        : [];
    const ingredientsByVersion = new Map();
    for (const ingredient of currentIngredients) {
        const key = String(ingredient.recipe_version_id);
        if (!ingredientsByVersion.has(key)) ingredientsByVersion.set(key, []);
        ingredientsByVersion.get(key).push(ingredient);
    }

    const legacyRecipes = dishNames.length
        ? await InventoryRecipe.findAll({
            where: { dish_name: { [Op.in]: dishNames } },
            attributes: ["dish_name", "item_id", "quantity_per_serving"],
        })
        : [];
    const legacyByName = new Map();
    for (const recipe of legacyRecipes) {
        const key = recipe.dish_name.toLocaleLowerCase();
        if (!legacyByName.has(key)) legacyByName.set(key, []);
        legacyByName.get(key).push(recipe);
    }

    const ingredientIds = [...new Set([
        ...currentIngredients.map((ingredient) => String(ingredient.item_id)),
        ...legacyRecipes.map((recipe) => String(recipe.item_id)),
    ])];
    const items = ingredientIds.length
        ? await InventoryItem.findAll({
            where: { inventory_item_id: { [Op.in]: ingredientIds } },
            attributes: ["inventory_item_id", "name", "unit_cost"],
        })
        : [];
    const batches = ingredientIds.length
        ? await InventoryBatch.findAll({
            where: { item_id: { [Op.in]: ingredientIds }, quantity: { [Op.gt]: 0 } },
            attributes: ["item_id", "quantity", "unit_cost"],
        })
        : [];
    const ingredientCosts = makeIngredientCostMap(items, batches);
    const itemNames = new Map(items.map((item) => [String(item.inventory_item_id), item.name]));

    const pricedDishes = dishes.map((dish) => {
        const currentRecipe = dish.menuItemId ? recipeByMenuItem.get(dish.menuItemId) : null;
        let recipeRows;
        let yieldQuantity = 1;
        let configured = false;
        if (currentRecipe) {
            const version = versionByRecipe.get(String(currentRecipe.inventory_menu_recipe_id));
            recipeRows = version ? ingredientsByVersion.get(String(version.inventory_menu_recipe_version_id)) || [] : [];
            yieldQuantity = Number(version?.base_production_quantity);
            configured = recipeRows.length > 0 && Number.isFinite(yieldQuantity) && yieldQuantity > 0;
        } else {
            recipeRows = legacyByName.get(dish.dishName.toLocaleLowerCase()) || [];
            configured = recipeRows.length > 0;
        }

        const costing = configured
            ? calculateRecipeCost(recipeRows.map((row) => ({
                ...row,
                item_name: itemNames.get(String(row.item_id)),
                quantity_per_serving: currentRecipe ? undefined : row.quantity_per_serving,
            })), ingredientCosts, currentRecipe ? yieldQuantity : 1)
            : {
                cost: null,
                missingIngredients: [currentRecipe ? "Current recipe version is incomplete" : "No recipe configured"],
            };
        const ingredientCostPerServing = costing.cost;
        const unitSellingPrice = dish.soldQuantity
            ? dish.netSales / dish.soldQuantity
            : 0;
        const grossProfitPerServing = ingredientCostPerServing === null
            ? null
            : unitSellingPrice - ingredientCostPerServing;
        return {
            dishName: dish.dishName,
            menuItemId: dish.menuItemId,
            soldQuantity: dish.soldQuantity,
            netSales: Math.round(dish.netSales * 100) / 100,
            unitSellingPrice: Math.round(unitSellingPrice * 100) / 100,
            ingredientCostPerServing: ingredientCostPerServing === null
                ? null
                : Math.round(ingredientCostPerServing * 100) / 100,
            grossProfitPerServing,
            totalGrossProfit: grossProfitPerServing === null
                ? null
                : grossProfitPerServing * dish.soldQuantity,
            costStatus: ingredientCostPerServing === null ? "missing" : "costed",
            missingIngredients: costing.missingIngredients,
        };
    });

    return {
        ...calculateMenuEngineering(pricedDishes),
        periodDays: days,
        since: since.toISOString(),
        truncated: sales.length === MAX_SALES || saleItems.length === MAX_SALE_ITEMS,
        analyzedPaidSales: paidSales.length,
    };
}
