import { createHmac, timingSafeEqual } from "node:crypto";
import { Op } from "sequelize";
import AggregatorOrder from "../models/aggregator-order.model.js";
import MenuItem from "../models/menu-item.model.js";
import { normalizeKotLines } from "../services/kot-orders.js";
import { createKotOrders } from "../services/create-kot-orders.js";

const PROVIDERS = ["swiggy", "zomato"];

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

function verifySignature(req, provider) {
    const secret = process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`];
    if (!secret) throw httpError(`${provider} webhook is not configured.`, 503);
    const supplied = String(req.get("x-provider-signature") || "").replace(/^sha256=/i, "");
    const rawBody = req.rawBody;
    if (!Buffer.isBuffer(rawBody) || !/^[a-f0-9]{64}$/i.test(supplied)) {
        throw httpError("A valid webhook signature is required.", 401);
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    const provided = Buffer.from(supplied, "hex");
    if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
        throw httpError("Webhook signature verification failed.", 401);
    }
}

function normalizeWebhook(body, provider) {
    const externalOrderId = String(body?.order_id ?? "").trim();
    if (!externalOrderId || externalOrderId.length > 120) throw httpError("order_id is required and must be at most 120 characters.");
    if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 100) throw httpError("items must contain between 1 and 100 lines.");
    const items = body.items.map((item) => {
        const menuItemId = String(item?.menu_item_id ?? "");
        const quantity = Number(item?.quantity);
        const notes = item?.notes ?? "";
        if (!/^[1-9]\d*$/.test(menuItemId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9999) {
            throw httpError("Each item requires a valid menu_item_id and positive whole-number quantity.");
        }
        if (typeof notes !== "string" || notes.length > 300) throw httpError("Item notes must be at most 300 characters.");
        return { menuItemId, quantity, notes: notes.trim() };
    });
    const total = Number(body.total_amount);
    if (!Number.isFinite(total) || total < 0 || total > 999999999999.99) throw httpError("total_amount must be a non-negative amount.");
    const customerName = body.customer?.name == null ? null : String(body.customer.name).trim().slice(0, 160);
    const customerPhone = body.customer?.phone == null ? null : String(body.customer.phone).trim().slice(0, 32);
    return {
        provider,
        external_order_id: externalOrderId,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        total_amount: Math.round(total * 100) / 100,
        items,
        payload: {},
    };
}

export async function receiveAggregatorWebhook(req, res, next) {
    try {
        const provider = String(req.params.provider || "").toLowerCase();
        if (!PROVIDERS.includes(provider)) throw httpError("Provider must be swiggy or zomato.");
        verifySignature(req, provider);
        const values = normalizeWebhook(req.body, provider);
        const menuItemIds = [...new Set(values.items.map((item) => item.menuItemId))];
        const menuItems = await MenuItem.findAll({
            where: { menu_item_id: { [Op.in]: menuItemIds }, is_available: true },
            attributes: ["menu_item_id", "name"],
        });
        if (menuItems.length !== menuItemIds.length) throw httpError("One or more aggregator items are unavailable or unmapped.", 409);
        const namesById = new Map(menuItems.map((item) => [String(item.menu_item_id), item.name]));
        values.items = values.items.map((item) => ({
            ...item,
            name: namesById.get(String(item.menuItemId)),
        }));
        const [order, created] = await AggregatorOrder.findOrCreate({
            where: { provider, external_order_id: values.external_order_id },
            defaults: values,
        });
        return res.status(created ? 201 : 200).json({ success: true, received: created, orderId: String(order.aggregator_order_id) });
    } catch (error) {
        return next(error);
    }
}

export async function listAggregatorOrders(req, res, next) {
    try {
        const limit = Number(req.query.limit ?? 100);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw httpError("limit must be between 1 and 100.");
        const orders = await AggregatorOrder.findAll({ order: [["createdAt", "DESC"]], limit });
        return res.json({ success: true, orders });
    } catch (error) {
        return next(error);
    }
}

export async function acceptAggregatorOrder(req, res, next) {
    try {
        const order = await AggregatorOrder.findByPk(req.params.id);
        if (!order) throw httpError("Aggregator order not found.", 404);
        if (order.status !== "new") throw httpError("Only new aggregator orders can be accepted.", 409);
        await order.update({ status: "accepted", accepted_at: new Date() });
        return res.json({ success: true, order });
    } catch (error) {
        return next(error);
    }
}

export async function assignAggregatorRider(req, res, next) {
    try {
        const riderName = String(req.body?.riderName ?? "").trim();
        if (!riderName || riderName.length > 120) throw httpError("riderName is required and must be at most 120 characters.");
        const order = await AggregatorOrder.findByPk(req.params.id);
        if (!order) throw httpError("Aggregator order not found.", 404);
        if (!["accepted", "fired"].includes(order.status)) throw httpError("Accept the order before assigning a rider.", 409);
        await order.update({ rider_name: riderName });
        return res.json({ success: true, order });
    } catch (error) {
        return next(error);
    }
}

export async function fireAggregatorOrder(req, res, next) {
    try {
        const order = await AggregatorOrder.findByPk(req.params.id);
        if (!order) throw httpError("Aggregator order not found.", 404);
        if (order.status !== "accepted") throw httpError("Accept this order before sending it to the kitchen.", 409);
        const items = normalizeKotLines(order.items);
        const kots = await createKotOrders({
            fireKey: `AGG-${order.provider}-${order.external_order_id}`,
            tableName: `${order.provider} #${order.external_order_id}`.slice(0, 64),
            lines: items,
            createdBy: req.user.id,
            orderType: order.provider,
        });
        await order.update({ status: "fired", fired_at: new Date() });
        return res.json({ success: true, order, kots });
    } catch (error) {
        return next(error);
    }
}
