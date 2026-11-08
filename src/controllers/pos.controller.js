import { Op } from "sequelize";
import { sequelize } from "../config/db.js";
import InventoryBatch from "../models/inventory-batch.model.js";
import InventoryItem from "../models/inventory-item.model.js";
import InventoryMovement from "../models/inventory-movement.model.js";
import InventoryRecipe from "../models/inventory-recipe.model.js";
import MenuItem from "../models/menu-item.model.js";
import PosSale from "../models/pos-sale.model.js";
import PosSaleItem from "../models/pos-sale-item.model.js";
import PosSaleTender from "../models/pos-sale-tender.model.js";
import PosSettings from "../models/pos-settings.model.js";
import { DEFAULT_POS_SETTINGS, normalizePosSettings } from "../services/pos-settings.js";
import { calculatePosTotals } from "../services/pos-sales.js";

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

function roundCurrency(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function positiveId(value, field) {
    if (!/^[1-9]\d*$/.test(String(value))) throw httpError(`${field} must be a positive integer.`);
    return String(value);
}

function money(value, field) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999.99 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
        throw httpError(`${field} must be a non-negative amount with at most two decimal places.`);
    }
    return amount;
}

function requiredText(value, field, max = 120) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
        throw httpError(`${field} is required and must be at most ${max} characters.`);
    }
    return value.trim();
}

async function loadSettings(transaction) {
    const [row] = await PosSettings.findOrCreate({
        where: { id: 1 },
        defaults: { id: 1, settings: DEFAULT_POS_SETTINGS },
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    return row;
}

async function serializeSale(sale, transaction) {
    const [items, tenders] = await Promise.all([
        PosSaleItem.findAll({ where: { sale_id: sale.pos_sale_id }, order: [["pos_sale_item_id", "ASC"]], transaction }),
        PosSaleTender.findAll({ where: { sale_id: sale.pos_sale_id }, order: [["pos_sale_tender_id", "ASC"]], transaction }),
    ]);
    return {
        id: String(sale.pos_sale_id),
        number: sale.bill_number,
        status: sale.status,
        items: items.map((item) => ({
            id: String(item.menu_item_id || item.pos_sale_item_id),
            menuItemId: item.menu_item_id ? String(item.menu_item_id) : null,
            name: item.item_name,
            quantity: Number(item.quantity),
            price: Number(item.unit_price),
            lineTotal: Number(item.line_total),
        })),
        subtotal: Number(sale.subtotal),
        discount: Number(sale.discount_amount),
        packaging: Number(sale.packaging_amount),
        tax: Number(sale.tax_amount),
        taxRate: Number(sale.tax_rate),
        total: Number(sale.total_amount),
        orderType: sale.order_type,
        paymentMethod: sale.payment_method,
        tenders: tenders.map((tender) => ({ method: tender.method, amount: Number(tender.amount) })),
        amountTendered: Number(sale.amount_tendered),
        amountPaid: Number(sale.amount_paid),
        changeDue: Number(sale.change_due),
        balanceDue: Number(sale.balance_due),
        stockDeducted: sale.stock_deducted,
        stockWarnings: sale.stock_warnings || [],
        completedAt: sale.completed_at,
    };
}

async function deductRecipeStock(menuLines, sale, transaction) {
    const recipeNames = [...new Set(menuLines.map((line) => line.menuItem.name))];
    const recipes = await InventoryRecipe.findAll({ where: { dish_name: recipeNames }, transaction });
    const recipesByDish = new Map();
    for (const recipe of recipes) {
        if (!recipesByDish.has(recipe.dish_name)) recipesByDish.set(recipe.dish_name, []);
        recipesByDish.get(recipe.dish_name).push(recipe);
    }

    const requirements = new Map();
    const stockWarnings = [];
    for (const line of menuLines) {
        const recipeRows = recipesByDish.get(line.menuItem.name) || [];
        if (!recipeRows.length) {
            stockWarnings.push(`${line.menuItem.name} has no recipe ingredients configured.`);
            continue;
        }
        for (const recipe of recipeRows) {
            const itemId = String(recipe.item_id);
            requirements.set(itemId, (requirements.get(itemId) || 0) + Number(recipe.quantity_per_serving) * line.quantity);
        }
    }

    const lockedItems = new Map();
    for (const [itemId, quantity] of [...requirements].sort(([left], [right]) => Number(left) - Number(right))) {
        const item = await InventoryItem.findByPk(itemId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!item || Number(item.quantity) + 0.000001 < quantity) {
            throw httpError(`Not enough ${item?.name || "inventory"} for this bill. No sale or stock change was recorded.`);
        }
        const batches = await InventoryBatch.findAll({
            where: { item_id: itemId, quantity: { [Op.gt]: 0 } },
            order: [["received_at", "ASC"], ["expiry_date", "ASC"], ["inventory_batch_id", "ASC"]],
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        const batchQuantity = batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
        if (batchQuantity + 0.000001 < quantity) {
            throw httpError(`Not enough batch stock for ${item.name}. No sale or stock change was recorded.`);
        }
        lockedItems.set(itemId, { item, quantity, batches });
    }

    for (const { item, quantity, batches } of lockedItems.values()) {
        let remaining = quantity;
        let totalCost = 0;
        for (const batch of batches) {
            if (remaining <= 0.000001) break;
            const used = Math.min(Number(batch.quantity), remaining);
            await batch.update({ quantity: Number(batch.quantity) - used }, { transaction });
            totalCost += used * Number(batch.unit_cost);
            remaining -= used;
        }
        const roundedCost = roundCurrency(totalCost);
        await item.update({ quantity: Number(item.quantity) - quantity }, { transaction });
        await InventoryMovement.create({
            item_id: item.inventory_item_id,
            movement_type: "POS consumption",
            quantity,
            unit_cost_snapshot: quantity ? roundedCost / quantity : 0,
            total_cost_snapshot: roundedCost,
            reason: `POS bill ${sale.bill_number}`,
            batch_code: "FIFO allocation",
        }, { transaction });
    }
    return { stockDeducted: requirements.size > 0, stockWarnings };
}

function normalizeLines(payload) {
    if (!Array.isArray(payload?.items) || !payload.items.length || payload.items.length > 100) {
        throw httpError("items must contain between 1 and 100 lines.");
    }
    const quantities = new Map();
    for (const line of payload.items) {
        const menuItemId = positiveId(line?.menuItemId, "menuItemId");
        const quantity = Number(line?.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9999) {
            throw httpError("Each item quantity must be a positive whole number.");
        }
        quantities.set(menuItemId, (quantities.get(menuItemId) || 0) + quantity);
    }
    return [...quantities].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
}

export const createPosSale = async (req, res, next) => {
    try {
        const idempotencyKey = requiredText(req.get("Idempotency-Key") || req.body?.idempotencyKey, "Idempotency-Key");
        const existing = await PosSale.findOne({ where: { idempotency_key: idempotencyKey } });
        if (existing) return res.json({ success: true, sale: await serializeSale(existing) });

        const lines = normalizeLines(req.body);
        const discountRequest = money(req.body?.discountAmount ?? 0, "discountAmount");
        const paymentMethod = requiredText(req.body?.paymentMethod, "paymentMethod", 16);
        const sale = await sequelize.transaction(async (transaction) => {
            const settingsRow = await loadSettings(transaction);
            const settings = normalizePosSettings(settingsRow.settings);
            const billNumber = `${settings.billNumberPrefix}${settings.nextBillNumber}`;
            if (billNumber.length > 64) throw httpError("The configured bill number exceeds 64 characters.");
            await settingsRow.update({
                settings: { ...settings, nextBillNumber: settings.nextBillNumber + 1 },
            }, { transaction });
            const menuItems = await MenuItem.findAll({
                where: { menu_item_id: lines.map((line) => line.menuItemId), is_available: true },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (menuItems.length !== lines.length) throw httpError("One or more menu items are no longer available.", 409);
            const menuById = new Map(menuItems.map((item) => [String(item.menu_item_id), item]));
            const menuLines = lines.map((line) => ({ ...line, menuItem: menuById.get(line.menuItemId) }));
            const subtotal = roundCurrency(menuLines.reduce((sum, line) => sum + Number(line.menuItem.price) * line.quantity, 0));
            const tenderSummary = calculatePosTotals({
                subtotal,
                discountAmount: discountRequest,
                orderType: req.body?.orderType ?? req.body?.order_type ?? "Dine-in",
                packagingAmount: req.body?.packagingAmount ?? req.body?.packaging_amount ?? 0,
                paymentMethod,
                tenders: req.body?.tenders,
                settings,
            });
            if (!settings.allowBalanceDue && tenderSummary.balanceDue > 0) throw httpError("Payment must cover the full bill total.");

            const createdSale = await PosSale.create({
                bill_number: billNumber,
                idempotency_key: idempotencyKey,
                status: tenderSummary.balanceDue > 0 ? "Partially paid" : "Paid",
                subtotal: tenderSummary.subtotal,
                discount_amount: tenderSummary.discountAmount,
                packaging_amount: tenderSummary.packagingAmount,
                tax_amount: tenderSummary.taxAmount,
                tax_rate: tenderSummary.taxRate,
                total_amount: tenderSummary.total,
                order_type: tenderSummary.orderType,
                amount_tendered: tenderSummary.amountTendered,
                amount_paid: tenderSummary.amountPaid,
                change_due: tenderSummary.changeDue,
                balance_due: tenderSummary.balanceDue,
                payment_method: paymentMethod,
                created_by: req.user?.id || null,
            }, { transaction });
            await PosSaleItem.bulkCreate(menuLines.map((line) => ({
                sale_id: createdSale.pos_sale_id,
                menu_item_id: line.menuItem.menu_item_id,
                item_name: line.menuItem.name,
                quantity: line.quantity,
                unit_price: Number(line.menuItem.price),
                line_total: roundCurrency(Number(line.menuItem.price) * line.quantity),
            })), { transaction });
            if (tenderSummary.tenders.length) {
                await PosSaleTender.bulkCreate(tenderSummary.tenders.map((tender) => ({
                    sale_id: createdSale.pos_sale_id,
                    ...tender,
                })), { transaction });
            }
            const stockResult = await deductRecipeStock(menuLines, createdSale, transaction);
            await createdSale.update(stockResult, { transaction });
            return createdSale;
        });
        return res.status(201).json({ success: true, sale: await serializeSale(sale) });
    } catch (error) {
        return next(error);
    }
};

export const listRecentPosSales = async (req, res, next) => {
    try {
        const limit = Number(req.query.limit ?? 5);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw httpError("limit must be between 1 and 50.");
        const sales = await PosSale.findAll({ order: [["completed_at", "DESC"]], limit });
        const serialized = [];
        for (const sale of sales) serialized.push(await serializeSale(sale));
        return res.json({ success: true, sales: serialized });
    } catch (error) {
        return next(error);
    }
};