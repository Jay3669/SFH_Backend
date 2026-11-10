import HappyHourRule from "../models/happy-hour-rule.model.js";
import MenuCategory from "../models/menu-category.model.js";
import { getPromoCategories, listPromotions, validatePromotion } from "../services/happy-hour.js";

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

export async function getPromotions(req, res, next) {
    try {
        return res.json({ success: true, promotions: await listPromotions() });
    } catch (error) {
        return next(error);
    }
}

export async function createPromotion(req, res, next) {
    try {
        const values = validatePromotion(req.body);
        const category = await MenuCategory.findByPk(values.category_id);
        if (!category || !category.is_active) throw httpError("Choose an active menu category.", 404);
        const promotion = await HappyHourRule.create(values);
        return res.status(201).json({ success: true, promotion });
    } catch (error) {
        return next(error);
    }
}

export async function updatePromotion(req, res, next) {
    try {
        if (!/^[1-9]\d*$/.test(String(req.params.id))) throw httpError("Promotion ID must be a positive integer.");
        const promotion = await HappyHourRule.findByPk(req.params.id);
        if (!promotion) throw httpError("Promotion not found.", 404);
        const values = validatePromotion(req.body);
        const category = await MenuCategory.findByPk(values.category_id);
        if (!category || !category.is_active) throw httpError("Choose an active menu category.", 404);
        await promotion.update(values);
        return res.json({ success: true, promotion });
    } catch (error) {
        return next(error);
    }
}

export async function deletePromotion(req, res, next) {
    try {
        const promotion = await HappyHourRule.findByPk(req.params.id);
        if (!promotion) throw httpError("Promotion not found.", 404);
        await promotion.destroy();
        return res.json({ success: true });
    } catch (error) {
        return next(error);
    }
}

export async function getActivePromotions(req, res, next) {
    try {
        const categoryIds = String(req.query.categoryIds || "").split(",").filter((id) => /^[1-9]\d*$/.test(id));
        return res.json({ success: true, promotions: await getPromoCategories(categoryIds), timeZone: "Asia/Kolkata" });
    } catch (error) {
        return next(error);
    }
}
