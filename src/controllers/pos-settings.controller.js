import PosSettings from "../models/pos-settings.model.js";
import { DEFAULT_POS_SETTINGS, normalizePosSettings } from "../services/pos-settings.js";

export const getPosSettings = async (req, res, next) => {
    try {
        const [settings] = await PosSettings.findOrCreate({
            where: { id: 1 },
            defaults: { id: 1, settings: DEFAULT_POS_SETTINGS },
        });
        return res.json({ success: true, settings: normalizePosSettings(settings.settings) });
    } catch (error) {
        return next(error);
    }
};

export const updatePosSettings = async (req, res, next) => {
    try {
        const settings = normalizePosSettings(req.body);
        await PosSettings.upsert({ id: 1, settings });
        return res.json({ success: true, settings });
    } catch (error) {
        return next(error);
    }
};