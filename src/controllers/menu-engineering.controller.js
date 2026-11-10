import { getMenuEngineeringAnalytics } from "../services/menu-engineering.js";

export async function getMenuEngineering(req, res, next) {
    try {
        const days = Number(req.query.days ?? 30);
        if (![30, 90, 365].includes(days)) {
            return res.status(400).json({ success: false, message: "days must be 30, 90, or 365." });
        }
        const analytics = await getMenuEngineeringAnalytics(days);
        return res.json({ success: true, ...analytics });
    } catch (error) {
        return next(error);
    }
}
