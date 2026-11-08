import { Op } from "sequelize";
import { sequelize } from "../config/db.js";
import MenuCategory from "../models/menu-category.model.js";

const categoryFields = new Set([
    "category_name",
    "description",
    "display_order",
    "is_active",
]);

function validateId(id) {
    return /^[1-9]\d*$/.test(id);
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

function validateCategoryField(field, value) {
    if (field === "category_name") {
        if (typeof value !== "string" || !value.trim()) {
            return { message: "category_name is required and cannot be empty." };
        }
        return { value: value.trim() };
    }

    if (field === "description") {
        if (value !== null && typeof value !== "string") {
            return { message: "description must be a string or null." };
        }
        return { value: typeof value === "string" ? value.trim() || null : null };
    }

    if (field === "display_order") {
        if (!Number.isSafeInteger(value) || value < 1) {
            return { message: "display_order must be a positive integer." };
        }
        return { value };
    }

    try {
        return { value: readBoolean(value, field) };
    } catch (error) {
        return { message: error.message };
    }
}

function validateBody(body, requiredFields = []) {
    const unknownFields = Object.keys(body).filter((field) => !categoryFields.has(field));
    if (unknownFields.length) {
        return { message: `Unsupported fields: ${unknownFields.join(", ")}.` };
    }

    const missingFields = requiredFields.filter((field) => body[field] === undefined);
    if (missingFields.length) {
        return { message: `Required fields: ${missingFields.join(", ")}.` };
    }

    const values = {};
    for (const [field, value] of Object.entries(body)) {
        const result = validateCategoryField(field, value);
        if (result.message) return result;
        values[field] = result.value;
    }
    return { values };
}

function isDuplicateCategoryName(error) {
    return error.name === "SequelizeUniqueConstraintError"
        && error.fields?.category_name !== undefined;
}

async function categoryNameExists(categoryName, excludeId, transaction) {
    const where = { category_name: categoryName };
    if (excludeId !== undefined) where.category_id = { [Op.ne]: excludeId };
    return Boolean(await MenuCategory.findOne({ where, transaction }));
}

async function lockCategoryOrder(transaction) {
    await sequelize.query("SELECT pg_advisory_xact_lock(1397048140, 1)", { transaction });
}

async function getOrderedCategories(transaction) {
    return MenuCategory.findAll({
        order: [["display_order", "ASC"], ["category_id", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
}

async function normalizeInvalidOrDuplicateOrders(categories, transaction) {
    const orders = new Set();
    const needsNormalization = categories.some((category) => {
        const order = Number(category.display_order);
        if (!Number.isSafeInteger(order) || order < 1 || orders.has(order)) return true;
        orders.add(order);
        return false;
    });

    if (!needsNormalization) return categories;

    for (const [index, category] of categories.entries()) {
        await category.update({ display_order: index + 1 }, { transaction });
    }
    return categories;
}

async function prepareOrderedCategories(transaction) {
    const categories = await getOrderedCategories(transaction);
    return normalizeInvalidOrDuplicateOrders(categories, transaction);
}

async function shiftOrdersAtOrAbove(categories, displayOrder, transaction) {
    const affected = categories
        .filter((category) => Number(category.display_order) >= displayOrder)
        .sort((left, right) => Number(right.display_order) - Number(left.display_order));
    for (const category of affected) {
        await category.update(
            { display_order: Number(category.display_order) + 1 },
            { transaction },
        );
    }
}

export const createMenuCategory = async (req, res, next) => {
    try {
        const body = { ...(req.body ?? {}) };
        if (body.display_order === null) delete body.display_order;
        const result = validateBody(body, ["category_name"]);
        if (result.message) return res.status(400).json({ success: false, message: result.message });

        let category;
        let duplicateName = false;
        await sequelize.transaction(async (transaction) => {
            await lockCategoryOrder(transaction);
            const categories = await prepareOrderedCategories(transaction);
            duplicateName = await categoryNameExists(
                result.values.category_name,
                undefined,
                transaction,
            );
            if (duplicateName) return;

            const usedOrders = new Set(categories.map((item) => Number(item.display_order)));
            let displayOrder = result.values.display_order;
            if (displayOrder === undefined) {
                displayOrder = 1;
                while (usedOrders.has(displayOrder)) displayOrder += 1;
            } else if (usedOrders.has(displayOrder)) {
                await shiftOrdersAtOrAbove(categories, displayOrder, transaction);
            }

            category = await MenuCategory.create(
                { ...result.values, display_order: displayOrder },
                { transaction },
            );
        });

        if (duplicateName) {
            return res.status(409).json({
                success: false,
                message: "A menu category with this name already exists.",
            });
        }
        return res.status(201).json({
            success: true,
            message: "Menu category created successfully.",
            category,
        });
    } catch (error) {
        if (isDuplicateCategoryName(error)) {
            return res.status(409).json({
                success: false,
                message: "A menu category with this name already exists.",
            });
        }
        return next(error);
    }
};

export const getMenuCategories = async (req, res, next) => {
    try {
        const page = parsePage(req.query.page, 1);
        const limit = parsePage(req.query.limit, 20);
        if (limit > 100) {
            return res.status(400).json({ success: false, message: "limit cannot exceed 100." });
        }

        const where = {};
        if (req.query.is_active !== undefined) {
            where.is_active = readBoolean(req.query.is_active, "is_active");
        }

        const { count, rows } = await MenuCategory.findAndCountAll({
            where,
            order: [["display_order", "ASC"], ["category_id", "ASC"]],
            limit,
            offset: (page - 1) * limit,
        });
        return res.json({
            success: true,
            categories: rows,
            pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
        });
    } catch (error) {
        return next(error);
    }
};

export const getMenuCategoryById = async (req, res, next) => {
    try {
        if (!validateId(req.params.id)) {
            return res.status(400).json({ success: false, message: "category_id must be a positive integer." });
        }
        const category = await MenuCategory.findByPk(req.params.id);
        if (!category) return res.status(404).json({ success: false, message: "Menu category not found." });
        return res.json({ success: true, category });
    } catch (error) {
        return next(error);
    }
};

export const updateMenuCategory = async (req, res, next) => {
    try {
        if (!validateId(req.params.id)) {
            return res.status(400).json({ success: false, message: "category_id must be a positive integer." });
        }

        const body = req.body ?? {};
        if (!Object.keys(body).length) {
            return res.status(400).json({ success: false, message: "At least one field is required." });
        }
        const result = validateBody(body);
        if (result.message) return res.status(400).json({ success: false, message: result.message });

        let category;
        let notFound = false;
        let duplicateName = false;
        await sequelize.transaction(async (transaction) => {
            await lockCategoryOrder(transaction);
            const categories = await prepareOrderedCategories(transaction);
            category = await MenuCategory.findByPk(req.params.id, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!category) {
                notFound = true;
                return;
            }
            if (
                result.values.category_name !== undefined
                && await categoryNameExists(
                    result.values.category_name,
                    category.category_id,
                    transaction,
                )
            ) {
                duplicateName = true;
                return;
            }

            if (
                result.values.display_order !== undefined
                && result.values.display_order !== Number(category.display_order)
            ) {
                const otherCategories = categories.filter(
                    (item) => String(item.category_id) !== String(category.category_id),
                );
                if (otherCategories.some(
                    (item) => Number(item.display_order) === result.values.display_order,
                )) {
                    await shiftOrdersAtOrAbove(
                        otherCategories,
                        result.values.display_order,
                        transaction,
                    );
                }
            }

            await category.update(result.values, { transaction });
        });

        if (notFound) {
            return res.status(404).json({ success: false, message: "Menu category not found." });
        }
        if (duplicateName) {
            return res.status(409).json({
                success: false,
                message: "A menu category with this name already exists.",
            });
        }
        return res.json({ success: true, message: "Menu category updated successfully.", category });
    } catch (error) {
        if (isDuplicateCategoryName(error)) {
            return res.status(409).json({
                success: false,
                message: "A menu category with this name already exists.",
            });
        }
        return next(error);
    }
};

export const deleteMenuCategory = async (req, res, next) => {
    try {
        if (!validateId(req.params.id)) {
            return res.status(400).json({ success: false, message: "category_id must be a positive integer." });
        }
        let notFound = false;
        await sequelize.transaction(async (transaction) => {
            await lockCategoryOrder(transaction);
            const categories = await prepareOrderedCategories(transaction);
            const category = await MenuCategory.findByPk(req.params.id, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!category) {
                notFound = true;
                return;
            }

            await category.destroy({ transaction });
            const remaining = categories.filter(
                (item) => String(item.category_id) !== String(category.category_id),
            );
            for (const [index, item] of remaining.entries()) {
                if (Number(item.display_order) !== index + 1) {
                    await item.update({ display_order: index + 1 }, { transaction });
                }
            }
        });
        if (notFound) {
            return res.status(404).json({ success: false, message: "Menu category not found." });
        }
        return res.json({ success: true, message: "Menu category deleted successfully." });
    } catch (error) {
        return next(error);
    }
};
