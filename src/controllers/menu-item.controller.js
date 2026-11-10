import { Op } from "sequelize";
import MenuCategory from "../models/menu-category.model.js";
import MenuItem from "../models/menu-item.model.js";
import { emitKitchenEvent } from "../services/kitchen-socket.js";

const itemFields = new Set([
    "category_id",
    "name",
    "description",
    "price",
    "is_available",
    "image_url",
    "food_type",
    "kitchen_station",
]);
const foodTypes = new Set(["Veg", "Non-Veg"]);
const kitchenStations = new Set(["Tandoor", "Curry", "Starters", "Beverages"]);
const priceSortOrders = new Map([
    ["price_asc", [["price", "ASC"], ["menu_item_id", "ASC"]]],
    ["price_desc", [["price", "DESC"], ["menu_item_id", "ASC"]]],
]);

function validateId(id) {
    if (typeof id === "number") return Number.isSafeInteger(id) && id > 0;
    return typeof id === "string" && /^[1-9]\d*$/.test(id);
}

function readBoolean(value, fieldName) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw Object.assign(new Error(`${fieldName} must be a boolean.`), { status: 400 });
}

function parsePage(value, fallback) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw Object.assign(new Error("page and limit must be positive integers."), { status: 400 });
    }
    return parsed;
}

function normalizeFoodType(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase().replace(/[\s-]/g, "");
    if (normalized === "veg") return "Veg";
    if (normalized === "nonveg") return "Non-Veg";
    return null;
}

function validateItemField(field, value) {
    if (field === "category_id") {
        if (!validateId(value)) return { message: "category_id must be a positive integer." };
        return { value: String(value) };
    }

    if (field === "name") {
        if (typeof value !== "string" || !value.trim()) {
            return { message: "name is required and cannot be empty." };
        }
        return { value: value.trim() };
    }

    if (field === "description") {
        if (value !== null && typeof value !== "string") {
            return { message: "description must be a string or null." };
        }
        return { value: typeof value === "string" ? value.trim() || null : null };
    }

    if (field === "price") {
        const priceValue = typeof value === "number"
            ? value
            : typeof value === "string" && /^\d+(?:\.\d{1,2})?$/.test(value.trim())
                ? Number(value.trim())
                : Number.NaN;
        if (
            !Number.isFinite(priceValue)
            || priceValue < 0
            || priceValue > 99999999.99
            || Math.abs(priceValue * 100 - Math.round(priceValue * 100)) > 1e-8
        ) {
            return { message: "price must be a non-negative number with at most two decimal places." };
        }
        return { value: priceValue.toFixed(2) };
    }

    if (field === "is_available") {
        try {
            return { value: readBoolean(value, field) };
        } catch (error) {
            return { message: error.message };
        }
    }

    if (field === "image_url") {
        if (value !== null && typeof value !== "string") {
            return { message: "image_url must be a valid HTTP(S) URL or null." };
        }
        if (value === null || !value.trim()) return { value: null };
        try {
            const url = new URL(value.trim());
            if (url.protocol !== "http:" && url.protocol !== "https:") {
                return { message: "image_url must be a valid HTTP(S) URL or null." };
            }
        } catch {
            return { message: "image_url must be a valid HTTP(S) URL or null." };
        }
        return { value: value.trim() };
    }

    if (field === "kitchen_station") {
        if (!kitchenStations.has(value)) {
            return { message: `kitchen_station must be one of: ${[...kitchenStations].join(", ")}.` };
        }
        return { value };
    }

    if (!foodTypes.has(value)) {
        return { message: "food_type must be either 'Veg' or 'Non-Veg'." };
    }
    return { value };
}

function validateBody(body, requiredFields = []) {
    const unknownFields = Object.keys(body).filter((field) => !itemFields.has(field));
    if (unknownFields.length) {
        return { message: `Unsupported fields: ${unknownFields.join(", ")}.` };
    }

    const missingFields = requiredFields.filter((field) => body[field] === undefined);
    if (missingFields.length) {
        return { message: `Required fields: ${missingFields.join(", ")}.` };
    }

    const values = {};
    for (const [field, value] of Object.entries(body)) {
        const result = validateItemField(field, value);
        if (result.message) return result;
        values[field] = result.value;
    }
    return { values };
}

async function ensureCategoryExists(categoryId) {
    return Boolean(await MenuCategory.findByPk(categoryId, { attributes: ["category_id"] }));
}

export const createMenuItem = async (req, res, next) => {
    try {
        const body = req.body ?? {};
        const result = validateBody(body, ["category_id", "name", "price", "food_type"]);
        if (result.message) {
            return res.status(400).json({ success: false, message: result.message });
        }
        if (!(await ensureCategoryExists(result.values.category_id))) {
            return res.status(400).json({ success: false, message: "category_id does not exist." });
        }

        const item = await MenuItem.create(result.values);
        return res.status(201).json({
            success: true,
            message: "Menu item created successfully.",
            item,
        });
    } catch (error) {
        return next(error);
    }
};

export const getMenuItems = async (req, res, next) => {
    try {
        const page = parsePage(req.query.page, 1);
        const limit = parsePage(req.query.limit, 20);
        if (limit > 100) {
            return res.status(400).json({ success: false, message: "limit cannot exceed 100." });
        }

        const where = {};
        if (req.query.category_id !== undefined) {
            if (!validateId(req.query.category_id)) {
                return res.status(400).json({ success: false, message: "category_id must be a positive integer." });
            }
            where.category_id = req.query.category_id;
        }
        if (req.query.search !== undefined) {
            if (typeof req.query.search !== "string") {
                return res.status(400).json({ success: false, message: "search must be a string." });
            }
            const search = req.query.search.trim();
            if (search) where.name = { [Op.iLike]: `%${search}%` };
        }
        if (req.query.is_available !== undefined) {
            where.is_available = readBoolean(req.query.is_available, "is_available");
        }
        if (req.query.food_type !== undefined) {
            const foodType = normalizeFoodType(req.query.food_type);
            if (!foodTypes.has(foodType)) {
                return res.status(400).json({ success: false, message: "food_type must be either 'Veg' or 'Non-Veg'." });
            }
            where.food_type = foodType;
        }

        let order = [["menu_item_id", "ASC"]];
        if (req.query.sort !== undefined) {
            order = typeof req.query.sort === "string"
                ? priceSortOrders.get(req.query.sort)
                : undefined;
        }
        if (!order) {
            return res.status(400).json({
                success: false,
                message: "sort must be 'price_asc' or 'price_desc'.",
            });
        }

        const { count, rows } = await MenuItem.findAndCountAll({
            where,
            include: [{ model: MenuCategory, as: "category", attributes: ["category_id", "category_name"] }],
            order,
            limit,
            offset: (page - 1) * limit,
        });
        return res.json({
            success: true,
            items: rows,
            pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
        });
    } catch (error) {
        return next(error);
    }
};

export const getMenuItemById = async (req, res, next) => {
    try {
        if (!validateId(req.params.id)) {
            return res.status(400).json({ success: false, message: "menu_item_id must be a positive integer." });
        }
        const item = await MenuItem.findByPk(req.params.id, {
            include: [{ model: MenuCategory, as: "category", attributes: ["category_id", "category_name"] }],
        });
        if (!item) return res.status(404).json({ success: false, message: "Menu item not found." });
        return res.json({ success: true, item });
    } catch (error) {
        return next(error);
    }
};

export const updateMenuItem = async (req, res, next) => {
    try {
        if (!validateId(req.params.id)) {
            return res.status(400).json({ success: false, message: "menu_item_id must be a positive integer." });
        }
        const body = req.body ?? {};
        if (!Object.keys(body).length) {
            return res.status(400).json({ success: false, message: "At least one field is required." });
        }
        const result = validateBody(body);
        if (result.message) {
            return res.status(400).json({ success: false, message: result.message });
        }
        if (
            result.values.category_id !== undefined
            && !(await ensureCategoryExists(result.values.category_id))
        ) {
            return res.status(400).json({ success: false, message: "category_id does not exist." });
        }

        const item = await MenuItem.findByPk(req.params.id);
        if (!item) return res.status(404).json({ success: false, message: "Menu item not found." });

        await item.update(result.values);
        await item.reload({
            include: [{ model: MenuCategory, as: "category", attributes: ["category_id", "category_name"] }],
        });
        emitKitchenEvent("menu:item-updated", item);
        return res.json({ success: true, message: "Menu item updated successfully.", item });
    } catch (error) {
        return next(error);
    }
};

export const deleteMenuItem = async (req, res, next) => {
    try {
        if (!validateId(req.params.id)) {
            return res.status(400).json({ success: false, message: "menu_item_id must be a positive integer." });
        }
        const item = await MenuItem.findByPk(req.params.id);
        if (!item) return res.status(404).json({ success: false, message: "Menu item not found." });

        await item.destroy();
        return res.json({ success: true, message: "Menu item deleted successfully." });
    } catch (error) {
        return next(error);
    }
};
