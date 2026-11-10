import { Op } from "sequelize";
import KotItem from "../models/kot-item.model.js";
import { summarizeKitchenTimings } from "../services/kitchen-analytics.js";

function httpError(message) {
    return Object.assign(new Error(message), { status: 400 });
}

export async function getKitchenAnalytics(req, res, next) {
    try {
        const days = Number(req.query.days ?? 30);
        if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw httpError("days must be between 1 and 365.");
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const items = await KotItem.findAll({
            where: { served_at: { [Op.gte]: since } },
            attributes: ["item_name", "quantity", "served_at"],
            include: [{ association: "order", attributes: ["createdAt"] }],
            order: [["served_at", "DESC"]],
            limit: 10000,
        });
        const dishes = summarizeKitchenTimings(items);
        return res.json({
            success: true,
            periodDays: days,
            timeZone: "Asia/Kolkata",
            completedItems: items.length,
            slowThresholdMinutes: 25,
            truncated: items.length === 10000,
            dishes,
        });
    } catch (error) {
        return next(error);
    }
}
