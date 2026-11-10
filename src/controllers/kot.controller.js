import { Op } from "sequelize";
import { sequelize } from "../config/db.js";
import KotItem from "../models/kot-item.model.js";
import KotOrder from "../models/kot-order.model.js";
import {
    canAdvanceKotStatus,
    deriveKotStatus,
    KOT_ORDER_TYPES,
    KITCHEN_STATIONS,
    KOT_STATUSES,
    normalizeKotLines,
} from "../services/kot-orders.js";
import { serializeKot } from "../services/serialize-kot.js";
import { createKotOrders } from "../services/create-kot-orders.js";

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

function requiredText(value, field, max = 120) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
        throw httpError(`${field} is required and must be at most ${max} characters.`);
    }
    return value.trim();
}

function positiveId(value, field) {
    const stringValue = String(value ?? "");
    if (!/^[1-9]\d*$/.test(stringValue)) throw httpError(`${field} must be a positive integer.`);
    return stringValue;
}

export const fireKot = async (req, res, next) => {
    try {
        const fireKey = requiredText(
            req.get("Idempotency-Key") || req.body?.idempotencyKey,
            "Idempotency-Key",
        );
        const tableName = requiredText(req.body?.tableName ?? req.body?.table_name, "tableName", 64);
        const lines = normalizeKotLines(req.body?.items);
        const orderType = req.body?.orderType || "Dine-in";
        if (!KOT_ORDER_TYPES.includes(orderType)) throw httpError(`orderType must be one of: ${KOT_ORDER_TYPES.join(", ")}.`);

        const createdKots = await createKotOrders({
            fireKey,
            tableName,
            lines,
            createdBy: req.user?.id || null,
            orderType,
        });
        return res.status(201).json({ success: true, kots: createdKots });
    } catch (error) {
        return next(error);
    }
};

export const listKitchenKots = async (req, res, next) => {
    try {
        const limit = Number(req.query.limit ?? 100);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            throw httpError("limit must be between 1 and 100.");
        }
        const where = { status: { [Op.ne]: "served" } };
        if (req.query.station !== undefined) {
            if (!KITCHEN_STATIONS.includes(req.query.station)) {
                throw httpError(`station must be one of: ${KITCHEN_STATIONS.join(", ")}.`);
            }
            where.station = req.query.station;
        }
        const orders = await KotOrder.findAll({
            where,
            order: [["createdAt", "ASC"], ["kot_number", "ASC"]],
            limit,
        });
        const kots = [];
        for (const order of orders) kots.push(await serializeKot(order));
        return res.json({ success: true, kots });
    } catch (error) {
        return next(error);
    }
};

export const updateKotItemStatus = async (req, res, next) => {
    try {
        const kotNumber = positiveId(req.params.kotNumber, "kotNumber");
        const kotItemId = positiveId(req.params.kotItemId, "kotItemId");
        const nextStatus = req.body?.status;
        if (!KOT_STATUSES.includes(nextStatus)) {
            throw httpError(`status must be one of: ${KOT_STATUSES.join(", ")}.`);
        }

        const kot = await sequelize.transaction(async (transaction) => {
            const order = await KotOrder.findByPk(kotNumber, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!order) throw httpError("KOT not found.", 404);
            const item = await KotItem.findOne({
                where: { kot_item_id: kotItemId, kot_number: kotNumber },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!item) throw httpError("KOT item not found.", 404);
            if (!canAdvanceKotStatus(item.status, nextStatus)) {
                throw httpError(`A ${item.status} item can only move to the next kitchen status.`, 409);
            }

            const timestamp = new Date();
            const timestamps = nextStatus === item.status ? {} : {
                ...(nextStatus === "cooking" ? { cooking_started_at: timestamp } : {}),
                ...(nextStatus === "ready" ? { ready_at: timestamp } : {}),
                ...(nextStatus === "served" ? { served_at: timestamp } : {}),
            };
            await item.update({ status: nextStatus, ...timestamps }, { transaction });
            const items = await KotItem.findAll({
                where: { kot_number: kotNumber },
                order: [["kot_item_id", "ASC"]],
                transaction,
            });
            await order.update({ status: deriveKotStatus(items) }, { transaction });
            return serializeKot(order, transaction);
        });
        emitKitchenEvent("kot:updated", kot);
        return res.json({ success: true, kot });
    } catch (error) {
        return next(error);
    }
};
