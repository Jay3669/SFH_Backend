import { Op } from "sequelize";
import { sequelize } from "../config/db.js";
import InventoryBatch from "../models/inventory-batch.model.js";
import InventoryItem from "../models/inventory-item.model.js";
import InventoryMenuRecipe from "../models/inventory-menu-recipe.model.js";
import InventoryMenuRecipeIngredient from "../models/inventory-menu-recipe-ingredient.model.js";
import InventoryMenuRecipeVersion from "../models/inventory-menu-recipe-version.model.js";
import InventoryMovement from "../models/inventory-movement.model.js";
import InventoryPreparationPlan from "../models/inventory-preparation-plan.model.js";
import InventoryPreparationPlanEntry from "../models/inventory-preparation-plan-entry.model.js";
import InventoryPurchase from "../models/inventory-purchase.model.js";
import InventoryProduction from "../models/inventory-production.model.js";
import InventoryProductionBatchAllocation from "../models/inventory-production-batch-allocation.model.js";
import InventoryProductionIngredient from "../models/inventory-production-ingredient.model.js";
import MenuItem from "../models/menu-item.model.js";
import { weightedUnitCost } from "../services/inventory-costs.js";
import { convertQuantity } from "../services/recipe-units.js";

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

function id(value, field = "id") {
    if (!/^[1-9]\d*$/.test(String(value))) throw httpError(`${field} must be a positive integer.`);
    return String(value);
}

function requiredText(value, field, max = 160, optional = false) {
    if (optional && (value === undefined || value === null || value === "")) return null;
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
        throw httpError(`${field} is required and must be at most ${max} characters.`);
    }
    return value.trim();
}

function positiveNumber(value, field, decimals = 3) {
    const parsed = Number(value);
    const scaled = parsed * 10 ** decimals;
    if (
        !Number.isFinite(parsed)
        || parsed <= 0
        || parsed > 99999999999.999
        || !Number.isFinite(scaled)
        || Math.abs(scaled - Math.round(scaled)) > 1e-7
    ) {
        throw httpError(`${field} must be greater than zero with at most ${decimals} decimal places.`);
    }
    return parsed;
}

function validateIdempotencyKey(value) {
    if (value === undefined) return null;
    return requiredText(value, "Idempotency-Key", 120);
}

async function loadRecipe(recipeId, transaction, lock = false) {
    const recipe = await InventoryMenuRecipe.findByPk(id(recipeId, "recipeId"), {
        transaction,
        ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
    });
    if (!recipe) throw httpError("Recipe not found.", 404);
    const version = await InventoryMenuRecipeVersion.findOne({
        where: { recipe_id: recipe.inventory_menu_recipe_id, version_number: recipe.current_version },
        transaction,
    });
    if (!version) throw httpError("The current recipe version is missing.", 500);
    const ingredients = await InventoryMenuRecipeIngredient.findAll({
        where: { recipe_version_id: version.inventory_menu_recipe_version_id },
        order: [["inventory_menu_recipe_ingredient_id", "ASC"]],
        transaction,
    });
    return { recipe, version, ingredients };
}

async function validateRecipePayload(payload, transaction) {
    const menuItemId = id(payload?.menuItemId, "menuItemId");
    const menuItem = await MenuItem.findByPk(menuItemId, { transaction });
    if (!menuItem) throw httpError("Menu item not found.");
    const name = requiredText(payload?.name || menuItem.name, "name");
    const baseProductionQuantity = positiveNumber(payload?.baseProductionQuantity, "baseProductionQuantity");
    const productionUnit = requiredText(payload?.productionUnit, "productionUnit", 24);
    const instructions = requiredText(payload?.instructions, "instructions", 10000, true);
    const status = payload?.status === undefined ? "Active" : payload.status;
    if (!["Active", "Inactive"].includes(status)) throw httpError("status must be Active or Inactive.");
    if (!Array.isArray(payload?.ingredients) || !payload.ingredients.length || payload.ingredients.length > 200) {
        throw httpError("ingredients must contain between 1 and 200 ingredient entries.");
    }
    const seen = new Set();
    const ingredients = [];
    for (const entry of payload.ingredients) {
        const itemId = id(entry?.itemId, "ingredient itemId");
        if (seen.has(itemId)) throw httpError("An inventory ingredient can only appear once in a recipe version.");
        seen.add(itemId);
        const item = await InventoryItem.findByPk(itemId, { transaction });
        if (!item) throw httpError(`Inventory ingredient ${itemId} was not found.`);
        const quantity = positiveNumber(entry.quantity, "ingredient quantity");
        const unit = requiredText(entry.unit, "ingredient unit", 24);
        convertQuantity(quantity, unit, item.unit);
        ingredients.push({
            item_id: item.inventory_item_id,
            quantity,
            unit,
            unit_cost_snapshot: Number(item.unit_cost),
        });
    }
    convertQuantity(baseProductionQuantity, productionUnit, productionUnit);
    return {
        menu_item_id: menuItem.menu_item_id,
        menuItem,
        name,
        baseProductionQuantity,
        productionUnit,
        instructions,
        status,
        ingredients,
    };
}

async function writeRecipeVersion(recipe, payload, transaction, actorId) {
    const versionNumber = Number(recipe.current_version) + 1;
    const version = await InventoryMenuRecipeVersion.create({
        recipe_id: recipe.inventory_menu_recipe_id,
        version_number: versionNumber,
        base_production_quantity: payload.baseProductionQuantity,
        production_unit: payload.productionUnit,
        preparation_instructions: payload.instructions,
        created_by: actorId || null,
    }, { transaction });
    await InventoryMenuRecipeIngredient.bulkCreate(payload.ingredients.map((ingredient) => ({
        ...ingredient,
        recipe_version_id: version.inventory_menu_recipe_version_id,
    })), { transaction });
    await recipe.update({
        menu_item_id: payload.menu_item_id,
        recipe_name: payload.name,
        current_version: versionNumber,
        status: payload.status,
        updated_by: actorId || null,
    }, { transaction });
    return version;
}

async function serializeRecipe(recipe, version, ingredientRows, transaction) {
    const menuItem = await MenuItem.findByPk(recipe.menu_item_id, { transaction });
    const items = await InventoryItem.findAll({
        where: { inventory_item_id: ingredientRows.map((entry) => entry.item_id) },
        transaction,
    });
    const batches = await InventoryBatch.findAll({
        where: { item_id: items.map((item) => item.inventory_item_id), quantity: { [Op.gt]: 0 } },
        transaction,
    });
    const batchesByItem = new Map();
    for (const batch of batches) {
        const key = String(batch.item_id);
        if (!batchesByItem.has(key)) batchesByItem.set(key, []);
        batchesByItem.get(key).push(batch);
    }
    const itemById = new Map(items.map((item) => [String(item.inventory_item_id), item]));
    const ingredients = ingredientRows.map((entry) => {
        const item = itemById.get(String(entry.item_id));
        const unitCost = weightedUnitCost(batchesByItem.get(String(entry.item_id)) || [], item?.unit_cost);
        const totalCost = convertQuantity(Number(entry.quantity), entry.unit, item.unit) * unitCost;
        return {
            id: String(entry.inventory_menu_recipe_ingredient_id),
            itemId: String(entry.item_id),
            name: item?.name || "",
            quantity: Number(entry.quantity),
            unit: entry.unit,
            inventoryUnit: item?.unit || "",
            unitCost,
            totalCost: Math.round(totalCost * 100) / 100,
        };
    });
    const totalRecipeCost = ingredients.reduce((total, entry) => total + entry.totalCost, 0);
    return {
        id: String(recipe.inventory_menu_recipe_id),
        menuItemId: String(recipe.menu_item_id),
        menuItemName: menuItem?.name || "",
        name: recipe.recipe_name,
        status: recipe.status,
        version: Number(version.version_number),
        baseProductionQuantity: Number(version.base_production_quantity),
        productionUnit: version.production_unit,
        instructions: version.preparation_instructions || "",
        ingredients,
        totalRecipeCost: Math.round(totalRecipeCost * 100) / 100,
        costPerProductionUnit: Math.round((totalRecipeCost / Number(version.base_production_quantity)) * 100) / 100,
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt,
    };
}

async function getRecipeData(recipeId, transaction) {
    const data = await loadRecipe(recipeId, transaction);
    return { ...data, serialized: await serializeRecipe(data.recipe, data.version, data.ingredients, transaction) };
}

async function calculateRequirements(recipeData, quantity, unit, transaction) {
    const { recipe, version, ingredients } = recipeData;
    const scale = convertQuantity(quantity, unit, version.production_unit) / Number(version.base_production_quantity);
    const itemIds = ingredients.map((entry) => entry.item_id);
    const items = await InventoryItem.findAll({ where: { inventory_item_id: itemIds }, transaction });
    const batches = await InventoryBatch.findAll({
        where: { item_id: itemIds, quantity: { [Op.gt]: 0 } },
        order: [["received_at", "ASC"], ["expiry_date", "ASC"], ["inventory_batch_id", "ASC"]],
        transaction,
    });
    const itemById = new Map(items.map((item) => [String(item.inventory_item_id), item]));
    const batchesByItem = new Map();
    for (const batch of batches) {
        const key = String(batch.item_id);
        if (!batchesByItem.has(key)) batchesByItem.set(key, []);
        batchesByItem.get(key).push(batch);
    }
    const result = ingredients.map((entry) => {
        const item = itemById.get(String(entry.item_id));
        const requiredQuantity = convertQuantity(Number(entry.quantity) * scale, entry.unit, item.unit);
        if (Math.abs(requiredQuantity * 1000 - Math.round(requiredQuantity * 1000)) > 1e-7) {
            throw httpError(`The converted quantity for ${item.name} exceeds the inventory precision of 0.001 ${item.unit}.`);
        }
        let remainingForCost = requiredQuantity;
        let totalCost = 0;
        for (const batch of batchesByItem.get(String(item.inventory_item_id)) || []) {
            if (remainingForCost <= 0) break;
            const used = Math.min(Number(batch.quantity), remainingForCost);
            totalCost += used * Number(batch.unit_cost);
            remainingForCost -= used;
        }
        if (remainingForCost > 0) totalCost += remainingForCost * Number(item.unit_cost);
        const availableStock = Math.min(
            Number(item.quantity),
            (batchesByItem.get(String(item.inventory_item_id)) || []).reduce((total, batch) => total + Number(batch.quantity), 0),
        );
        const roundedCost = Math.round((totalCost + Number.EPSILON) * 100) / 100;
        return {
            itemId: String(item.inventory_item_id),
            ingredientName: item.name,
            requiredQuantity,
            recipeQuantity: Number(entry.quantity) * scale,
            recipeUnit: entry.unit,
            unit: item.unit,
            unitCost: requiredQuantity ? totalCost / requiredQuantity : 0,
            totalCost: roundedCost,
            availableStock,
            remainingStock: availableStock - requiredQuantity,
            sufficient: availableStock + 0.000001 >= requiredQuantity,
        };
    });
    return {
        recipeId: String(recipe.inventory_menu_recipe_id),
        recipeName: recipe.recipe_name,
        recipeVersion: Number(version.version_number),
        productionQuantity: quantity,
        productionUnit: unit,
        totalIngredientCost: Math.round(result.reduce((sum, entry) => sum + entry.totalCost, 0) * 100) / 100,
        sufficient: result.every((entry) => entry.sufficient),
        ingredients: result,
    };
}

function batchCode(prefix) {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function serializeProduction(production, transaction) {
    const rows = await InventoryProductionIngredient.findAll({
        where: { production_id: production.inventory_production_id },
        order: [["inventory_production_ingredient_id", "ASC"]],
        transaction,
    });
    return {
        id: String(production.inventory_production_id),
        productionNumber: production.production_number,
        recipeId: String(production.recipe_id),
        recipeVersionId: String(production.recipe_version_id),
        recipeName: production.recipe_name_snapshot,
        productionQuantity: Number(production.production_quantity),
        productionUnit: production.production_unit,
        productionDate: production.production_date,
        status: production.status,
        totalCost: Number(production.total_cost),
        idempotencyKey: production.idempotency_key,
        confirmedAt: production.confirmed_at,
        cancelledAt: production.cancelled_at,
        cancellationReason: production.cancellation_reason || "",
        ingredients: rows.map((row) => ({
            itemId: String(row.item_id),
            name: row.ingredient_name_snapshot,
            requiredQuantity: Number(row.required_quantity),
            unit: row.unit,
            unitCost: Number(row.unit_cost_snapshot),
            totalCost: Number(row.total_cost_snapshot),
        })),
    };
}

export const getRecipes = async (req, res, next) => {
    try {
        const recipes = await InventoryMenuRecipe.findAll({ order: [["recipe_name", "ASC"], ["inventory_menu_recipe_id", "ASC"]] });
        const data = [];
        for (const recipe of recipes) data.push((await getRecipeData(recipe.inventory_menu_recipe_id)).serialized);
        return res.json({ success: true, recipes: data });
    } catch (error) {
        return next(error);
    }
};

export const getRecipeInventoryItems = async (req, res, next) => {
    try {
        const items = await InventoryItem.findAll({ order: [["name", "ASC"]] });
        return res.json({
            success: true,
            items: items.map((item) => ({
                id: String(item.inventory_item_id),
                name: item.name,
                unit: item.unit,
                quantity: Number(item.quantity),
                reorderLevel: Number(item.reorder_level),
                unitCost: Number(item.unit_cost),
            })),
        });
    } catch (error) {
        return next(error);
    }
};

export const getRecipeById = async (req, res, next) => {
    try {
        const { serialized } = await getRecipeData(req.params.id);
        return res.json({ success: true, recipe: serialized });
    } catch (error) {
        return next(error);
    }
};

export const getRecipeVersions = async (req, res, next) => {
    try {
        const recipe = await InventoryMenuRecipe.findByPk(id(req.params.id, "recipeId"));
        if (!recipe) throw httpError("Recipe not found.", 404);
        const versions = await InventoryMenuRecipeVersion.findAll({
            where: { recipe_id: recipe.inventory_menu_recipe_id },
            order: [["version_number", "DESC"]],
        });
        const result = [];
        for (const version of versions) {
            const ingredients = await InventoryMenuRecipeIngredient.findAll({
                where: { recipe_version_id: version.inventory_menu_recipe_version_id },
                order: [["inventory_menu_recipe_ingredient_id", "ASC"]],
            });
            result.push(await serializeRecipe(recipe, version, ingredients));
        }
        return res.json({ success: true, versions: result });
    } catch (error) {
        return next(error);
    }
};

export const getRecipeVersionById = async (req, res, next) => {
    try {
        const recipeId = id(req.params.id, "recipeId");
        const versionNumber = Number(req.params.versionNumber);
        if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) throw httpError("versionNumber must be a positive integer.");
        const recipe = await InventoryMenuRecipe.findByPk(recipeId);
        if (!recipe) throw httpError("Recipe not found.", 404);
        const version = await InventoryMenuRecipeVersion.findOne({
            where: { recipe_id: recipeId, version_number: versionNumber },
        });
        if (!version) throw httpError("Recipe version not found.", 404);
        const ingredients = await InventoryMenuRecipeIngredient.findAll({
            where: { recipe_version_id: version.inventory_menu_recipe_version_id },
            order: [["inventory_menu_recipe_ingredient_id", "ASC"]],
        });
        return res.json({ success: true, recipe: await serializeRecipe(recipe, version, ingredients) });
    } catch (error) {
        return next(error);
    }
};

export const createRecipeDefinition = async (req, res, next) => {
    try {
        const saved = await sequelize.transaction(async (transaction) => {
            const payload = await validateRecipePayload(req.body, transaction);
            const recipe = await InventoryMenuRecipe.create({
                menu_item_id: payload.menu_item_id,
                recipe_name: payload.name,
                current_version: 0,
                status: payload.status,
                created_by: req.user?.id || null,
                updated_by: req.user?.id || null,
            }, { transaction });
            const version = await writeRecipeVersion(recipe, payload, transaction, req.user?.id);
            const ingredients = await InventoryMenuRecipeIngredient.findAll({ where: { recipe_version_id: version.inventory_menu_recipe_version_id }, transaction });
            return serializeRecipe(recipe, version, ingredients, transaction);
        });
        return res.status(201).json({ success: true, recipe: saved });
    } catch (error) {
        return next(error);
    }
};

export const updateRecipeDefinition = async (req, res, next) => {
    try {
        const saved = await sequelize.transaction(async (transaction) => {
            const recipe = await InventoryMenuRecipe.findByPk(id(req.params.id, "recipeId"), { transaction, lock: transaction.LOCK.UPDATE });
            if (!recipe) throw httpError("Recipe not found.", 404);
            const payload = await validateRecipePayload(req.body, transaction);
            const version = await writeRecipeVersion(recipe, payload, transaction, req.user?.id);
            const ingredients = await InventoryMenuRecipeIngredient.findAll({ where: { recipe_version_id: version.inventory_menu_recipe_version_id }, transaction });
            return serializeRecipe(recipe, version, ingredients, transaction);
        });
        return res.json({ success: true, recipe: saved });
    } catch (error) {
        return next(error);
    }
};

export const deactivateRecipe = async (req, res, next) => {
    try {
        const recipe = await InventoryMenuRecipe.findByPk(id(req.params.id, "recipeId"));
        if (!recipe) throw httpError("Recipe not found.", 404);
        await recipe.update({ status: "Inactive", updated_by: req.user?.id || null });
        return res.json({ success: true, message: "Recipe deactivated." });
    } catch (error) {
        return next(error);
    }
};

export const listRecipeIngredients = async (req, res, next) => {
    try {
        const { serialized } = await getRecipeData(req.params.recipeId);
        return res.json({ success: true, ingredients: serialized.ingredients, version: serialized.version });
    } catch (error) {
        return next(error);
    }
};

export const addRecipeIngredient = async (req, res, next) => {
    try {
        const recipe = await getRecipeData(req.params.recipeId);
        const itemId = id(req.body?.itemId, "itemId");
        const quantity = positiveNumber(req.body?.quantity, "quantity");
        const unit = requiredText(req.body?.unit, "unit", 24);
        const ingredients = recipe.ingredients.map((entry) => ({
            itemId: String(entry.item_id),
            quantity: Number(entry.quantity),
            unit: entry.unit,
        }));
        ingredients.push({ itemId, quantity, unit });
        const payload = {
            menuItemId: String(recipe.recipe.menu_item_id),
            name: recipe.recipe.recipe_name,
            baseProductionQuantity: Number(recipe.version.base_production_quantity),
            productionUnit: recipe.version.production_unit,
            instructions: recipe.version.preparation_instructions || "",
            status: recipe.recipe.status,
            ingredients,
        };
        const updated = await sequelize.transaction(async (transaction) => {
            const locked = await InventoryMenuRecipe.findByPk(recipe.recipe.inventory_menu_recipe_id, { transaction, lock: transaction.LOCK.UPDATE });
            const validated = await validateRecipePayload(payload, transaction);
            const version = await writeRecipeVersion(locked, validated, transaction, req.user?.id);
            const rows = await InventoryMenuRecipeIngredient.findAll({ where: { recipe_version_id: version.inventory_menu_recipe_version_id }, transaction });
            return serializeRecipe(locked, version, rows, transaction);
        });
        return res.status(201).json({ success: true, recipe: updated });
    } catch (error) {
        return next(error);
    }
};

export const updateRecipeIngredient = async (req, res, next) => {
    try {
        const recipe = await getRecipeData(req.params.recipeId);
        const targetId = id(req.params.ingredientId, "ingredientId");
        let found = false;
        const ingredients = recipe.ingredients.map((entry) => {
            if (entry.inventory_menu_recipe_ingredient_id && String(entry.inventory_menu_recipe_ingredient_id) === targetId) {
                found = true;
                return {
                    itemId: id(req.body?.itemId ?? entry.item_id, "itemId"),
                    quantity: positiveNumber(req.body?.quantity ?? entry.quantity, "quantity"),
                    unit: requiredText(req.body?.unit ?? entry.unit, "unit", 24),
                };
            }
            return { itemId: String(entry.item_id), quantity: Number(entry.quantity), unit: entry.unit };
        });
        if (!found) throw httpError("Recipe ingredient not found in the current version.", 404);
        const payload = {
            menuItemId: String(recipe.recipe.menu_item_id),
            name: recipe.recipe.recipe_name,
            baseProductionQuantity: Number(recipe.version.base_production_quantity),
            productionUnit: recipe.version.production_unit,
            instructions: recipe.version.preparation_instructions || "",
            status: recipe.recipe.status,
            ingredients,
        };
        const updated = await sequelize.transaction(async (transaction) => {
            const locked = await InventoryMenuRecipe.findByPk(recipe.recipe.inventory_menu_recipe_id, { transaction, lock: transaction.LOCK.UPDATE });
            const validated = await validateRecipePayload(payload, transaction);
            const version = await writeRecipeVersion(locked, validated, transaction, req.user?.id);
            const rows = await InventoryMenuRecipeIngredient.findAll({ where: { recipe_version_id: version.inventory_menu_recipe_version_id }, transaction });
            return serializeRecipe(locked, version, rows, transaction);
        });
        return res.json({ success: true, recipe: updated });
    } catch (error) {
        return next(error);
    }
};

export const deleteRecipeIngredient = async (req, res, next) => {
    try {
        const recipe = await getRecipeData(req.params.recipeId);
        const targetId = id(req.params.ingredientId, "ingredientId");
        const currentIngredient = recipe.ingredients.find((entry) => String(entry.inventory_menu_recipe_ingredient_id) === targetId);
        if (!currentIngredient) throw httpError("Recipe ingredient not found in the current version.", 404);
        if (recipe.ingredients.length <= 1) throw httpError("A recipe must have at least one ingredient.");
        const payload = {
            menuItemId: String(recipe.recipe.menu_item_id),
            name: recipe.recipe.recipe_name,
            baseProductionQuantity: Number(recipe.version.base_production_quantity),
            productionUnit: recipe.version.production_unit,
            instructions: recipe.version.preparation_instructions || "",
            status: recipe.recipe.status,
            ingredients: recipe.ingredients
                .filter((entry) => String(entry.inventory_menu_recipe_ingredient_id) !== targetId)
                .map((entry) => ({ itemId: String(entry.item_id), quantity: Number(entry.quantity), unit: entry.unit })),
        };
        const updated = await sequelize.transaction(async (transaction) => {
            const locked = await InventoryMenuRecipe.findByPk(recipe.recipe.inventory_menu_recipe_id, { transaction, lock: transaction.LOCK.UPDATE });
            const validated = await validateRecipePayload(payload, transaction);
            const version = await writeRecipeVersion(locked, validated, transaction, req.user?.id);
            const rows = await InventoryMenuRecipeIngredient.findAll({ where: { recipe_version_id: version.inventory_menu_recipe_version_id }, transaction });
            return serializeRecipe(locked, version, rows, transaction);
        });
        return res.json({ success: true, recipe: updated });
    } catch (error) {
        return next(error);
    }
};

export const previewProduction = async (req, res, next) => {
    try {
        const recipeData = await getRecipeData(req.body?.recipeId);
        if (recipeData.recipe.status !== "Active") throw httpError("Inactive recipes cannot be prepared.");
        const quantity = positiveNumber(req.body?.quantity, "quantity");
        const unit = requiredText(req.body?.unit || recipeData.version.production_unit, "unit", 24);
        const preview = await calculateRequirements(recipeData, quantity, unit);
        return res.json({ success: true, message: "Production calculation completed successfully.", data: preview });
    } catch (error) {
        return next(error);
    }
};

export const createProductionDraft = async (req, res, next) => {
    try {
        let recipeData = await getRecipeData(req.body?.recipeId);
        if (recipeData.recipe.status !== "Active") throw httpError("Inactive recipes cannot be prepared.");
        const quantity = positiveNumber(req.body?.quantity, "quantity");
        const unit = requiredText(req.body?.unit || recipeData.version.production_unit, "unit", 24);
        const productionDate = validDate(req.body?.productionDate || new Date().toISOString().slice(0, 10), "productionDate");
        const key = validateIdempotencyKey(req.get("Idempotency-Key") || req.body?.idempotencyKey);
        let production;
        if (key) production = await InventoryProduction.findOne({ where: { idempotency_key: key } });
        if (production) {
            const sameQuantity = Math.abs(convertQuantity(quantity, unit, production.production_unit) - Number(production.production_quantity)) < 0.000001;
            if (
                String(production.recipe_id) !== String(recipeData.recipe.inventory_menu_recipe_id)
                || !sameQuantity
                || production.production_date !== productionDate
            ) {
                throw httpError("This Idempotency-Key is already associated with a different production request.", 409);
            }
            const version = await InventoryMenuRecipeVersion.findByPk(production.recipe_version_id);
            const ingredients = await InventoryMenuRecipeIngredient.findAll({ where: { recipe_version_id: production.recipe_version_id } });
            const recipe = await InventoryMenuRecipe.findByPk(production.recipe_id);
            recipeData = { recipe, version, ingredients };
        }
        if (!production) {
            production = await InventoryProduction.create({
                production_number: batchCode("PROD"),
                recipe_id: recipeData.recipe.inventory_menu_recipe_id,
                recipe_version_id: recipeData.version.inventory_menu_recipe_version_id,
                recipe_name_snapshot: recipeData.recipe.recipe_name,
                production_quantity: quantity,
                production_unit: unit,
                production_date: productionDate,
                status: "Draft",
                idempotency_key: key,
                created_by: req.user?.id || null,
                updated_by: req.user?.id || null,
            });
        }
        const preview = await calculateRequirements(recipeData, quantity, unit);
        return res.status(201).json({ success: true, production: await serializeProduction(production), preview });
    } catch (error) {
        return next(error);
    }
};

export const listProductions = async (req, res, next) => {
    try {
        const where = {};
        if (req.query.status !== undefined) {
            if (!["Draft", "Confirmed", "Cancelled"].includes(req.query.status)) throw httpError("status must be Draft, Confirmed, or Cancelled.");
            where.status = req.query.status;
        }
        if (req.query.from || req.query.to) {
            where.production_date = {};
            if (req.query.from) where.production_date[Op.gte] = req.query.from;
            if (req.query.to) where.production_date[Op.lte] = req.query.to;
        }
        const rows = await InventoryProduction.findAll({ where, order: [["production_date", "DESC"], ["createdAt", "DESC"]], limit: 500 });
        const productions = [];
        for (const row of rows) productions.push(await serializeProduction(row));
        return res.json({ success: true, productions });
    } catch (error) {
        return next(error);
    }
};

export const getProductionById = async (req, res, next) => {
    try {
        const production = await InventoryProduction.findByPk(id(req.params.id, "productionId"));
        if (!production) throw httpError("Production entry not found.", 404);
        return res.json({ success: true, production: await serializeProduction(production) });
    } catch (error) {
        return next(error);
    }
};

export const confirmProduction = async (req, res, next) => {
    try {
        const production = await sequelize.transaction(async (transaction) => {
            const entry = await InventoryProduction.findByPk(id(req.params.id, "productionId"), { transaction, lock: transaction.LOCK.UPDATE });
            if (!entry) throw httpError("Production entry not found.", 404);
            if (entry.status === "Confirmed") return entry;
            if (entry.status !== "Draft") throw httpError("Only draft production entries can be confirmed.");
            const recipeData = await loadRecipe(entry.recipe_id, transaction);
            if (String(recipeData.version.inventory_menu_recipe_version_id) !== String(entry.recipe_version_id)) {
                const oldVersion = await InventoryMenuRecipeVersion.findByPk(entry.recipe_version_id, { transaction });
                recipeData.version = oldVersion;
                recipeData.ingredients = await InventoryMenuRecipeIngredient.findAll({
                    where: { recipe_version_id: entry.recipe_version_id },
                    transaction,
                });
            }
            const calculations = await calculateRequirements(
                recipeData,
                Number(entry.production_quantity),
                entry.production_unit,
                transaction,
            );
            if (!calculations.sufficient) {
                const shortage = calculations.ingredients.find((ingredient) => !ingredient.sufficient);
                throw httpError(`Insufficient ${shortage.ingredientName}: ${shortage.availableStock} ${shortage.unit} available, ${shortage.requiredQuantity} ${shortage.unit} required.`);
            }
            const lockedItems = new Map();
            for (const requirement of [...calculations.ingredients].sort((a, b) => a.itemId.localeCompare(b.itemId, undefined, { numeric: true }))) {
                const item = await InventoryItem.findByPk(requirement.itemId, { transaction, lock: transaction.LOCK.UPDATE });
                if (!item || Number(item.quantity) + 0.000001 < requirement.requiredQuantity) {
                    throw httpError(`Insufficient ${item?.name || requirement.ingredientName} stock to confirm production.`);
                }
                lockedItems.set(requirement.itemId, { item, requirement });
            }
            let totalCost = 0;
            for (const { item, requirement } of lockedItems.values()) {
                let remaining = requirement.requiredQuantity;
                const batches = await InventoryBatch.findAll({
                    where: { item_id: item.inventory_item_id, quantity: { [Op.gt]: 0 } },
                    order: [["received_at", "ASC"], ["expiry_date", "ASC"], ["inventory_batch_id", "ASC"]],
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });
                let consumedCost = 0;
                const productionIngredient = await InventoryProductionIngredient.create({
                    production_id: entry.inventory_production_id,
                    item_id: item.inventory_item_id,
                    ingredient_name_snapshot: item.name,
                    required_quantity: requirement.requiredQuantity,
                    unit: item.unit,
                    unit_cost_snapshot: requirement.unitCost,
                    total_cost_snapshot: requirement.totalCost,
                }, { transaction });
                for (const batch of batches) {
                    if (remaining <= 0.000001) break;
                    const used = Math.min(Number(batch.quantity), remaining);
                    await batch.update({ quantity: Number(batch.quantity) - used }, { transaction });
                    consumedCost += used * Number(batch.unit_cost);
                    await InventoryProductionBatchAllocation.create({
                        production_ingredient_id: productionIngredient.inventory_production_ingredient_id,
                        batch_id: batch.inventory_batch_id,
                        batch_code_snapshot: batch.batch_code,
                        quantity: used,
                    }, { transaction });
                    remaining -= used;
                }
                if (remaining > 0.000001) throw httpError(`Insufficient ${item.name} batch stock to confirm production.`);
                consumedCost = Math.round(consumedCost * 100) / 100;
                await productionIngredient.update({
                    unit_cost_snapshot: consumedCost / requirement.requiredQuantity,
                    total_cost_snapshot: consumedCost,
                }, { transaction });
                await item.update({ quantity: Number(item.quantity) - requirement.requiredQuantity }, { transaction });
                await InventoryMovement.create({
                    item_id: item.inventory_item_id,
                    movement_type: "Recipe production",
                    quantity: requirement.requiredQuantity,
                    unit_cost_snapshot: consumedCost / requirement.requiredQuantity,
                    total_cost_snapshot: consumedCost,
                    reason: `Production ${entry.production_number} · ${entry.recipe_name_snapshot}`,
                    batch_code: "FIFO allocation",
                }, { transaction });
                totalCost += consumedCost;
            }
            await entry.update({
                status: "Confirmed",
                total_cost: Math.round(totalCost * 100) / 100,
                confirmed_at: new Date(),
                updated_by: req.user?.id || null,
            }, { transaction });
            return entry;
        });
        const serialized = await serializeProduction(production);
        const updatedItems = await InventoryItem.findAll({
            where: { inventory_item_id: serialized.ingredients.map((ingredient) => ingredient.itemId) },
        });
        return res.json({
            success: true,
            message: "Production confirmed and inventory deducted.",
            production: serialized,
            updatedStock: updatedItems.map((item) => ({
                itemId: String(item.inventory_item_id),
                name: item.name,
                quantity: Number(item.quantity),
                unit: item.unit,
            })),
        });
    } catch (error) {
        return next(error);
    }
};

export const cancelProduction = async (req, res, next) => {
    try {
        const production = await sequelize.transaction(async (transaction) => {
            const entry = await InventoryProduction.findByPk(id(req.params.id, "productionId"), { transaction, lock: transaction.LOCK.UPDATE });
            if (!entry) throw httpError("Production entry not found.", 404);
            if (entry.status === "Cancelled") return entry;
            if (!["Draft", "Confirmed"].includes(entry.status)) throw httpError("This production entry cannot be cancelled.");
            if (entry.status === "Confirmed") {
                const ingredientRows = await InventoryProductionIngredient.findAll({
                    where: { production_id: entry.inventory_production_id },
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });
                for (const ingredient of ingredientRows) {
                    const item = await InventoryItem.findByPk(ingredient.item_id, { transaction, lock: transaction.LOCK.UPDATE });
                    const allocations = await InventoryProductionBatchAllocation.findAll({
                        where: { production_ingredient_id: ingredient.inventory_production_ingredient_id },
                        transaction,
                    });
                    for (const allocation of allocations) {
                        const batch = await InventoryBatch.findByPk(allocation.batch_id, { transaction, lock: transaction.LOCK.UPDATE });
                        if (!batch) throw httpError(`Original batch ${allocation.batch_code_snapshot} no longer exists; production cannot be reversed.`, 409);
                        await batch.update({ quantity: Number(batch.quantity) + Number(allocation.quantity) }, { transaction });
                    }
                    await item.update({ quantity: Number(item.quantity) + Number(ingredient.required_quantity) }, { transaction });
                    await InventoryMovement.create({
                        item_id: item.inventory_item_id,
                        movement_type: "Production reversal",
                        quantity: ingredient.required_quantity,
                        unit_cost_snapshot: Number(ingredient.unit_cost_snapshot),
                        total_cost_snapshot: Number(ingredient.total_cost_snapshot),
                        reason: `Reversal of production ${entry.production_number}`,
                        batch_code: "Restored to original batches",
                    }, { transaction });
                }
            }
            await entry.update({
                status: "Cancelled",
                cancelled_at: new Date(),
                cancellation_reason: requiredText(req.body?.reason, "reason", 2000, true),
                updated_by: req.user?.id || null,
            }, { transaction });
            return entry;
        });
        return res.json({ success: true, message: "Production cancelled; consumed stock was restored to its original batches.", production: await serializeProduction(production) });
    } catch (error) {
        return next(error);
    }
};

function validDate(value, field) {
    if (
        typeof value !== "string"
        || !/^\d{4}-\d{2}-\d{2}$/.test(value)
        || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
    ) {
        throw httpError(`${field} must be a valid YYYY-MM-DD date.`);
    }
    return value;
}

function dateBounds(req, period) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (period === "daily") {
        const date = validDate(req.query.date || today, "date");
        return [date, date];
    }
    if (period === "weekly") {
        if (req.query.from || req.query.to) {
            const from = validDate(req.query.from, "from");
            const to = validDate(req.query.to, "to");
            if (from > to) throw httpError("from must not be later than to.");
            return [from, to];
        }
        const date = new Date(`${validDate(req.query.date || today, "date")}T00:00:00Z`);
        const weekday = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() - weekday + 1);
        const from = date.toISOString().slice(0, 10);
        date.setUTCDate(date.getUTCDate() + 6);
        return [from, date.toISOString().slice(0, 10)];
    }
    if (period === "monthly") {
        const month = req.query.month || today.slice(0, 7);
        if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) throw httpError("month must use YYYY-MM format.");
        const [year, monthNumber] = month.split("-").map(Number);
        if (monthNumber < 1 || monthNumber > 12) throw httpError("month must use YYYY-MM format.");
        const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
        return [`${month}-01`, `${month}-${String(lastDay).padStart(2, "0")}`];
    }
    const to = validDate(req.query.to || today, "to");
    const defaultFromDate = new Date(`${to}T00:00:00Z`);
    defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29);
    const from = validDate(req.query.from || defaultFromDate.toISOString().slice(0, 10), "from");
    if (from > to) throw httpError("from must not be later than to.");
    return [from, to];
}

async function buildConsumptionReport(req, period) {
    const [from, to] = dateBounds(req, period);
    const where = {
        production_date: { [Op.gte]: from, [Op.lte]: to },
        status: "Confirmed",
    };
    if (req.query.status !== undefined) {
        if (!["Draft", "Confirmed", "Cancelled"].includes(req.query.status)) throw httpError("status filter is invalid.");
        where.status = req.query.status;
    }
    if (req.query.recipeId !== undefined) where.recipe_id = id(req.query.recipeId, "recipeId");
    const productions = await InventoryProduction.findAll({
        where,
        order: [["production_date", "ASC"], ["createdAt", "ASC"]],
    });
    const productionRows = [];
    const ingredientTotals = new Map();
    let totalProductionCost = 0;
    const productionQuantitiesByUnit = new Map();
    for (const production of productions) {
        const productionData = await serializeProduction(production);
        if (req.query.itemId !== undefined) {
            const itemId = id(req.query.itemId, "itemId");
            productionData.ingredients = productionData.ingredients.filter((ingredient) => ingredient.itemId === itemId);
            if (!productionData.ingredients.length) continue;
        }
        productionRows.push(productionData);
        totalProductionCost += req.query.itemId
            ? productionData.ingredients.reduce((sum, ingredient) => sum + ingredient.totalCost, 0)
            : Number(production.total_cost);
        const quantityUnit = production.production_unit;
        productionQuantitiesByUnit.set(quantityUnit, (productionQuantitiesByUnit.get(quantityUnit) || 0) + Number(production.production_quantity));
        for (const ingredient of productionData.ingredients) {
            const key = ingredient.itemId;
            const current = ingredientTotals.get(key) || {
                itemId: key,
                name: ingredient.name,
                quantity: 0,
                unit: ingredient.unit,
                cost: 0,
            };
            current.quantity += ingredient.requiredQuantity;
            current.cost += ingredient.totalCost;
            ingredientTotals.set(key, current);
        }
    }
    const [items, purchases, batches] = await Promise.all([
        InventoryItem.findAll(),
        InventoryPurchase.findAll({
            where: {
                order_date: { [Op.gte]: from, [Op.lte]: to },
                status: { [Op.ne]: "Cancelled" },
            },
        }),
        InventoryBatch.findAll({ where: { quantity: { [Op.gt]: 0 } } }),
    ]);
    const currentStock = items.map((item) => ({
        itemId: String(item.inventory_item_id),
        name: item.name,
        quantity: Number(item.quantity),
        unit: item.unit,
        reorderLevel: Number(item.reorder_level),
    }));
    return {
        period,
        from,
        to,
        productionCount: productionRows.length,
        productionQuantitiesByUnit: [...productionQuantitiesByUnit].map(([unit, quantity]) => ({ unit, quantity })),
        totalProductionCost: Math.round(totalProductionCost * 100) / 100,
        purchaseSpend: Math.round(purchases.reduce((sum, purchase) =>
            sum + Number(purchase.received_quantity) * Number(purchase.unit_price), 0) * 100) / 100,
        currentInventoryValue: Math.round(batches.reduce((sum, batch) =>
            sum + Number(batch.quantity) * Number(batch.unit_cost), 0) * 100) / 100,
        productions: productionRows,
        ingredientTotals: [...ingredientTotals.values()].map((entry) => ({
            ...entry,
            quantity: Math.round(entry.quantity * 1000) / 1000,
            cost: Math.round(entry.cost * 100) / 100,
        })),
        currentStock,
        lowStockItems: currentStock.filter((item) => item.quantity <= item.reorderLevel),
    };
}

function reportHandler(period) {
    return async (req, res, next) => {
        try {
            return res.json({ success: true, report: await buildConsumptionReport(req, period) });
        } catch (error) {
            return next(error);
        }
    };
}

export const getDailyConsumption = reportHandler("daily");
export const getWeeklyConsumption = reportHandler("weekly");
export const getMonthlyConsumption = reportHandler("monthly");
export const getConsumptionSummary = reportHandler("summary");

async function buildPlanSummary(plan, transaction) {
    const entries = await InventoryPreparationPlanEntry.findAll({
        where: { plan_id: plan.inventory_preparation_plan_id },
        order: [["inventory_preparation_plan_entry_id", "ASC"]],
        transaction,
    });
    const totalsByItem = new Map();
    const plannedProductions = [];
    for (const entry of entries) {
        const version = await InventoryMenuRecipeVersion.findByPk(entry.recipe_version_id, { transaction });
        const recipe = await InventoryMenuRecipe.findByPk(entry.recipe_id, { transaction });
        const ingredients = await InventoryMenuRecipeIngredient.findAll({
            where: { recipe_version_id: entry.recipe_version_id },
            transaction,
        });
        const calculations = await calculateRequirements(
            { recipe, version, ingredients },
            Number(entry.production_quantity),
            entry.production_unit,
            transaction,
        );
        plannedProductions.push({
            recipeId: String(recipe.inventory_menu_recipe_id),
            recipeName: entry.recipe_name_snapshot,
            productionQuantity: Number(entry.production_quantity),
            productionUnit: entry.production_unit,
            ingredients: calculations.ingredients,
        });
        for (const ingredient of calculations.ingredients) {
            const current = totalsByItem.get(ingredient.itemId) || {
                itemId: ingredient.itemId,
                name: ingredient.ingredientName,
                requiredQuantity: 0,
                availableStock: ingredient.availableStock,
                unit: ingredient.unit,
            };
            current.requiredQuantity += ingredient.requiredQuantity;
            totalsByItem.set(ingredient.itemId, current);
        }
    }
    const requirements = [...totalsByItem.values()].map((entry) => {
        const shortageQuantity = Math.max(0, entry.requiredQuantity - entry.availableStock);
        return {
            ...entry,
            requiredQuantity: Math.round(entry.requiredQuantity * 1000) / 1000,
            shortageQuantity: Math.round(shortageQuantity * 1000) / 1000,
            availableAfterPlan: Math.round((entry.availableStock - entry.requiredQuantity) * 1000) / 1000,
        };
    });
    const items = await InventoryItem.findAll({
        where: { inventory_item_id: requirements.map((entry) => entry.itemId) },
        transaction,
    });
    const itemById = new Map(items.map((item) => [String(item.inventory_item_id), item]));
    const purchaseSuggestions = requirements
        .filter((entry) => entry.shortageQuantity > 0)
        .map((entry) => ({
            itemId: entry.itemId,
            name: entry.name,
            quantity: entry.shortageQuantity,
            unit: entry.unit,
            estimatedCost: Math.round(entry.shortageQuantity * Number(itemById.get(entry.itemId)?.unit_cost || 0) * 100) / 100,
        }));
    return {
        id: String(plan.inventory_preparation_plan_id),
        date: plan.planned_date,
        productions: plannedProductions,
        requirements,
        shortages: purchaseSuggestions,
        estimatedPurchaseCost: Math.round(purchaseSuggestions.reduce((sum, entry) => sum + entry.estimatedCost, 0) * 100) / 100,
    };
}

export const createPreparationPlan = async (req, res, next) => {
    try {
        const plannedDate = validDate(req.body?.date || new Date(Date.now() + 86400000).toISOString().slice(0, 10), "date");
        if (!Array.isArray(req.body?.productions) || req.body.productions.length === 0 || req.body.productions.length > 200) {
            throw httpError("productions must contain between 1 and 200 planned recipes.");
        }
        const plan = await sequelize.transaction(async (transaction) => {
            const created = await InventoryPreparationPlan.create({
                planned_date: plannedDate,
                created_by: req.user?.id || null,
            }, { transaction });
            for (const planned of req.body.productions) {
                const recipeData = await loadRecipe(planned.recipeId, transaction);
                if (recipeData.recipe.status !== "Active") throw httpError(`${recipeData.recipe.recipe_name} is inactive and cannot be planned.`);
                const quantity = positiveNumber(planned.quantity, "production quantity");
                const unit = requiredText(planned.unit || recipeData.version.production_unit, "production unit", 24);
                convertQuantity(quantity, unit, recipeData.version.production_unit);
                await InventoryPreparationPlanEntry.create({
                    plan_id: created.inventory_preparation_plan_id,
                    recipe_id: recipeData.recipe.inventory_menu_recipe_id,
                    recipe_version_id: recipeData.version.inventory_menu_recipe_version_id,
                    recipe_name_snapshot: recipeData.recipe.recipe_name,
                    production_quantity: quantity,
                    production_unit: unit,
                }, { transaction });
            }
            return created;
        });
        return res.status(201).json({ success: true, plan: await buildPlanSummary(plan) });
    } catch (error) {
        return next(error);
    }
};

async function findPlanForRequest(req) {
    if (req.query.planId !== undefined) {
        const plan = await InventoryPreparationPlan.findByPk(id(req.query.planId, "planId"));
        if (!plan) throw httpError("Preparation plan not found.", 404);
        return plan;
    }
    const date = validDate(req.query.date || new Date(Date.now() + 86400000).toISOString().slice(0, 10), "date");
    const plan = await InventoryPreparationPlan.findOne({
        where: { planned_date: date },
        order: [["createdAt", "DESC"]],
    });
    if (!plan) throw httpError("No preparation plan exists for this date.", 404);
    return plan;
}

export const getNextDayRequirements = async (req, res, next) => {
    try {
        const plan = await findPlanForRequest(req);
        return res.json({ success: true, plan: await buildPlanSummary(plan) });
    } catch (error) {
        return next(error);
    }
};

export const getPreparationShortages = async (req, res, next) => {
    try {
        const plan = await findPlanForRequest(req);
        const summary = await buildPlanSummary(plan);
        return res.json({ success: true, date: summary.date, shortages: summary.shortages });
    } catch (error) {
        return next(error);
    }
};

export const getPurchaseSuggestions = async (req, res, next) => {
    try {
        const plan = await findPlanForRequest(req);
        const summary = await buildPlanSummary(plan);
        return res.json({
            success: true,
            date: summary.date,
            suggestions: summary.shortages,
            estimatedPurchaseCost: summary.estimatedPurchaseCost,
        });
    } catch (error) {
        return next(error);
    }
};