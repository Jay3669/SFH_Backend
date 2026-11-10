import HappyHourRule from "../models/happy-hour-rule.model.js";
import { calculatePromotionDiscountForRules, isRuleActive } from "./happy-hour-rules.js";
export { calculatePromotionDiscountForRules, isRuleActive, validatePromotion } from "./happy-hour-rules.js";

export async function activePromotionRules(date = new Date()) {
    const rules = await HappyHourRule.findAll({ where: { is_active: true } });
    return rules.filter((rule) => isRuleActive(rule, date));
}

export async function calculatePromotionDiscount(lines, date = new Date()) {
    const rules = await HappyHourRule.findAll({ where: { is_active: true } });
    return calculatePromotionDiscountForRules(lines, rules, date);
}

export async function listPromotions() {
    return HappyHourRule.findAll({
        include: [{ association: "category", attributes: ["category_id", "category_name"] }],
        order: [["createdAt", "DESC"]],
    });
}

export async function getPromoCategories(categoryIds) {
    const rules = await activePromotionRules();
    const matching = rules.filter((rule) => categoryIds.includes(String(rule.category_id)));
    return matching.map((rule) => ({
        categoryId: String(rule.category_id),
        discountPercent: Number(rule.discount_percent),
        name: rule.name,
    }));
}
