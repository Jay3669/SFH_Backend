import bcrypt from "bcrypt";
import { sequelize } from "../config/db.js";
import MenuItem from "../models/menu-item.model.js";
import PosSale from "../models/pos-sale.model.js";
import PosSaleItem from "../models/pos-sale-item.model.js";
import PosSaleTender from "../models/pos-sale-tender.model.js";
import OrderPayment from "../models/order-payment.model.js";
import CashDrawer from "../models/cash-drawer.model.js";
import PosSettings from "../models/pos-settings.model.js";
import User from "../models/user.model.js";
import DiscountAuthorization from "../models/discount-authorization.model.js";
import DiscountPinAttempt from "../models/discount-pin-attempt.model.js";
import WhatsAppDelivery from "../models/whatsapp-delivery.model.js";
import VoidAudit from "../models/void-audit.model.js";
import { enqueuePosSaleInventoryDeduction } from "../services/inventory-consumption.js";
import { DEFAULT_POS_SETTINGS, normalizePosSettings } from "../services/pos-settings.js";
import { calculatePosTotals } from "../services/pos-sales.js";
import {
    discountApprovalRequired,
    matchDiscountApprover,
    nextPinAttemptState,
    normalizeCompItemIds,
    validateDiscountAuthorization,
} from "../services/discount-authorizations.js";
import { calculatePromotionDiscount } from "../services/happy-hour.js";
import { sendWhatsAppBill } from "../services/whatsapp-bills.js";

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
    const [items, paymentRows, legacyTenders, whatsappDelivery, voidAudit] = await Promise.all([
        PosSaleItem.findAll({ where: { sale_id: sale.pos_sale_id }, order: [["pos_sale_item_id", "ASC"]], transaction }),
        OrderPayment.findAll({ where: { order_id: sale.pos_sale_id }, order: [["order_payment_id", "ASC"]], transaction }),
        PosSaleTender.findAll({ where: { sale_id: sale.pos_sale_id }, order: [["pos_sale_tender_id", "ASC"]], transaction }),
        WhatsAppDelivery.findOne({ where: { sale_id: sale.pos_sale_id }, attributes: ["status", "error_message"], transaction }),
        VoidAudit.findOne({ where: { sale_id: sale.pos_sale_id }, transaction }),
    ]);
    const tenders = paymentRows.length
        ? paymentRows.map((payment) => ({
            method: payment.payment_mode,
            amount: Number(payment.amount),
            transactionRef: payment.transaction_ref,
        }))
        : legacyTenders.map((tender) => ({ method: tender.method, amount: Number(tender.amount), transactionRef: null }));
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
            comp: item.is_comp,
            notes: item.notes || "",
        })),
        subtotal: Number(sale.subtotal),
        discount: Number(sale.discount_amount),
        promotionalDiscount: Number(sale.promotional_discount_amount || 0),
        packaging: Number(sale.packaging_amount),
        tax: Number(sale.tax_amount),
        taxRate: Number(sale.tax_rate),
        total: Number(sale.total_amount),
        orderType: sale.order_type,
        paymentMethod: sale.payment_method,
        tenders,
        amountTendered: Number(sale.amount_tendered),
        amountPaid: Number(sale.amount_paid),
        changeDue: Number(sale.change_due),
        balanceDue: Number(sale.balance_due),
        stockDeducted: sale.stock_deducted,
        stockDeductionStatus: sale.stock_deduction_status,
        stockWarnings: sale.stock_warnings || [],
        completedAt: sale.completed_at,
        whatsappDelivery: whatsappDelivery
            ? { status: whatsappDelivery.status, message: whatsappDelivery.error_message || "" }
            : sale.whatsapp_opt_in ? { status: sale.status === "Paid" ? "skipped" : "pending_payment" } : null,
        voidAudit: voidAudit ? {
            reason: voidAudit.reason,
            previousStatus: voidAudit.previous_status,
            amount: Number(voidAudit.amount),
            requestedBy: String(voidAudit.requested_by_id),
            approvedBy: String(voidAudit.approved_by_id),
            voidedAt: voidAudit.createdAt,
        } : null,
    };
}

function normalizeLines(payload) {
    if (!Array.isArray(payload?.items) || !payload.items.length || payload.items.length > 100) {
        throw httpError("items must contain between 1 and 100 lines.");
    }
    const lines = new Map();
    for (const line of payload.items) {
        const menuItemId = positiveId(line?.menuItemId, "menuItemId");
        const quantity = Number(line?.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
            throw httpError("Each item quantity must be a whole number between 1 and 99.");
        }
        const note = line?.notes ?? "";
        if (typeof note !== "string" || note.length > 300) {
            throw httpError("Each item note must be a string of at most 300 characters.");
        }
        const notes = note.trim();
        const key = `${menuItemId}\u0000${notes}`;
        const current = lines.get(key);
        if (current) {
            current.quantity += quantity;
            if (current.quantity > 99) {
                throw httpError("Each item quantity must be a whole number between 1 and 99.");
            }
        }
        else lines.set(key, { menuItemId, quantity, notes });
    }
    return [...lines.values()];
}

function normalizeCustomerPhone(value) {
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw httpError("Customer phone must be a string.");
    const digits = value.replace(/\D/g, "");
    const indianDigits = digits.startsWith("91") && digits.length === 12 ? digits.slice(2) : digits;
    if (!/^[6-9]\d{9}$/.test(indianDigits)) throw httpError("Enter a valid 10-digit Indian mobile number.");
    return `+91${indianDigits}`;
}

async function recordFailedPinAttempt(userId) {
    await sequelize.transaction(async (transaction) => {
        const [attempt] = await DiscountPinAttempt.findOrCreate({
            where: { user_id: userId },
            defaults: { user_id: userId, failed_attempts: 0 },
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        const state = nextPinAttemptState(attempt);
        await attempt.update({
            failed_attempts: state.failedAttempts,
            window_started_at: state.windowStartedAt,
            locked_until: state.lockedUntil,
        }, { transaction });
    });
}

async function verifyDiscountPin(pin, requesterId, transaction) {
    const attempt = await DiscountPinAttempt.findByPk(requesterId);
    if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
        throw httpError("Manager PIN verification is temporarily locked. Try again in 15 minutes.", 429);
    }

    const approvers = await User.findAll({
        where: { role: ["Admin", "Manager"], status: "active" },
        attributes: ["id", "role", "status", "manager_pin_hash"],
    });
    const matchedApprover = await matchDiscountApprover(pin, approvers);
    if (!matchedApprover) {
        await recordFailedPinAttempt(requesterId);
        throw httpError("The manager PIN is invalid or has not been configured.", 403);
    }
    const approver = await User.findByPk(matchedApprover.id, {
        attributes: ["id", "role", "status", "manager_pin_hash"],
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    if (
        !approver
        || !["Admin", "Manager"].includes(approver.role)
        || approver.status !== "active"
        || approver.manager_pin_hash !== matchedApprover.manager_pin_hash
    ) {
        throw httpError("Manager PIN verification failed. Please try again.", 403);
    }
    if (attempt) {
        await attempt.update({ failed_attempts: 0, window_started_at: null, locked_until: null });
    }
    return approver;
}

export const createPosSale = async (req, res, next) => {
    try {
        const idempotencyKey = requiredText(req.get("Idempotency-Key") || req.body?.idempotencyKey, "Idempotency-Key");
        const existing = await PosSale.findOne({ where: { idempotency_key: idempotencyKey } });
        if (existing) {
            if (req.user.role === "Employee" && String(existing.created_by) !== String(req.user.id)) {
                throw httpError("Bill not found.", 404);
            }
            return res.json({ success: true, sale: await serializeSale(existing) });
        }

        const lines = normalizeLines(req.body);
        const discountRequest = money(req.body?.discountAmount ?? 0, "discountAmount");
        const customerPhone = normalizeCustomerPhone(req.body?.customerPhone);
        const whatsappOptIn = req.body?.whatsappOptIn === true;
        if (req.body?.whatsappOptIn !== undefined && typeof req.body.whatsappOptIn !== "boolean") {
            throw httpError("whatsappOptIn must be a boolean.");
        }
        if (whatsappOptIn && !customerPhone) throw httpError("A valid customer phone number is required to send a WhatsApp bill.");
        const compItemIds = normalizeCompItemIds(
            req.body?.compItemIds,
            new Set(lines.map((line) => line.menuItemId)),
        );
        const paymentMethod = requiredText(req.body?.paymentMethod, "paymentMethod", 16);
        const sale = await sequelize.transaction(async (transaction) => {
            const drawer = await CashDrawer.findOne({
                where: { cashier_id: req.user.id, status: "open" },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!drawer) throw httpError("Open a cash drawer before creating a POS sale.", 409);
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
            const compAmount = roundCurrency(menuLines
                .filter((line) => compItemIds.includes(line.menuItemId))
                .reduce((sum, line) => sum + Number(line.menuItem.price) * line.quantity, 0));
            const { discountAmount: promotionalDiscount } = await calculatePromotionDiscount(menuLines.map((line) => ({
                ...line,
                isComp: compItemIds.includes(line.menuItemId),
            })));
            if (req.body?.promotionalDiscountAmount !== undefined) {
                const expectedPromotion = money(req.body.promotionalDiscountAmount, "promotionalDiscountAmount");
                if (Math.abs(expectedPromotion - promotionalDiscount) > 0.01) {
                    throw httpError("Scheduled discounts changed while this bill was open. Refresh the bill and confirm the updated total.", 409);
                }
            }
            const totalDiscount = roundCurrency(discountRequest + compAmount + promotionalDiscount);
            if (totalDiscount > subtotal) throw httpError("Total discounts and comps cannot exceed the subtotal.");
            const needsApproval = discountApprovalRequired({
                subtotal,
                discountAmount: discountRequest + compAmount,
                compItemIds,
            });
            const authorizationInput = validateDiscountAuthorization({
                authorization: req.body?.discountAuthorization,
                required: needsApproval,
            });
            const approver = authorizationInput
                ? await verifyDiscountPin(authorizationInput.pin, req.user.id, transaction)
                : null;
            const tenderSummary = calculatePosTotals({
                subtotal,
                discountAmount: totalDiscount,
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
                stock_deduction_status: tenderSummary.balanceDue > 0 ? "awaiting_payment" : "pending",
                subtotal: tenderSummary.subtotal,
                discount_amount: tenderSummary.discountAmount,
                promotional_discount_amount: promotionalDiscount,
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
                customer_phone: customerPhone,
                whatsapp_opt_in: whatsappOptIn,
                created_by: req.user?.id || null,
            }, { transaction });
            await PosSaleItem.bulkCreate(menuLines.map((line) => ({
                sale_id: createdSale.pos_sale_id,
                menu_item_id: line.menuItem.menu_item_id,
                item_name: line.menuItem.name,
                quantity: line.quantity,
                unit_price: Number(line.menuItem.price),
                line_total: roundCurrency(Number(line.menuItem.price) * line.quantity),
                is_comp: compItemIds.includes(line.menuItemId),
                notes: line.notes || null,
            })), { transaction });
            if (approver) {
                await DiscountAuthorization.create({
                    order_id: createdSale.pos_sale_id,
                    requested_by_id: req.user.id,
                    approved_by_id: approver.id,
                    reason_code: authorizationInput.reasonCode,
                    authorization_type: compItemIds.length
                        ? discountRequest > 0 ? "mixed" : "comp"
                        : "discount",
                    discount_amount: roundCurrency(discountRequest + compAmount),
                    comp_item_ids: compItemIds,
                }, { transaction });
            }
            if (tenderSummary.tenders.length) {
                await OrderPayment.bulkCreate(tenderSummary.tenders.map((tender) => ({
                    order_id: createdSale.pos_sale_id,
                    payment_mode: tender.method,
                    transaction_ref: tender.transactionRef,
                    amount: tender.amount,
                })), { transaction });
                await PosSaleTender.bulkCreate(tenderSummary.tenders.map((tender) => ({
                    sale_id: createdSale.pos_sale_id,
                    method: tender.method,
                    amount: tender.amount,
                })), { transaction });
            }
            if (tenderSummary.balanceDue === 0) {
                await enqueuePosSaleInventoryDeduction(menuLines, createdSale, transaction);
            }
            return createdSale;
        });
        const whatsappDelivery = await sendWhatsAppBill(sale);
        return res.status(201).json({
            success: true,
            sale: { ...await serializeSale(sale), whatsappDelivery },
        });
    } catch (error) {
        return next(error);
    }
};

export const setManagerPin = async (req, res, next) => {
    try {
        if (!["Admin", "Manager"].includes(req.user.role)) {
            throw httpError("Only Admins and Managers can configure an approval PIN.", 403);
        }
        const { currentPassword, pin, confirmPin } = req.body ?? {};
        if (typeof currentPassword !== "string" || !currentPassword) {
            throw httpError("Current password is required.");
        }
        if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
            throw httpError("Manager PIN must contain exactly four digits.");
        }
        if (confirmPin !== pin) throw httpError("PIN confirmation does not match.");
        const user = await User.findByPk(req.user.id, { attributes: ["id", "password", "role"] });
        if (!user || !["Admin", "Manager"].includes(user.role) || !(await bcrypt.compare(currentPassword, user.password))) {
            throw httpError("Current password is incorrect.", 403);
        }
        await user.update({ manager_pin_hash: await bcrypt.hash(pin, 12) });
        return res.json({ success: true, message: "Manager approval PIN saved." });
    } catch (error) {
        return next(error);
    }
};

export const resendWhatsAppBill = async (req, res, next) => {
    try {
        const saleId = positiveId(req.params.saleId, "saleId");
        const sale = await PosSale.findByPk(saleId);
        if (!sale) throw httpError("Bill not found.", 404);
        if (req.user.role === "Employee" && String(sale.created_by) !== String(req.user.id)) {
            throw httpError("Bill not found.", 404);
        }
        if (!sale.whatsapp_opt_in) throw httpError("The customer did not consent to WhatsApp bill delivery.", 409);
        const whatsappDelivery = await sendWhatsAppBill(sale, { retry: true });
        return res.json({ success: true, whatsappDelivery });
    } catch (error) {
        return next(error);
    }
};

export const voidPosSale = async (req, res, next) => {
    try {
        const saleId = positiveId(req.params.saleId, "saleId");
        const reason = requiredText(req.body?.reason, "reason", 500);
        const pin = req.body?.pin;
        if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
            throw httpError("A supervisor's 4-digit PIN is required.");
        }

        const sale = await sequelize.transaction(async (transaction) => {
            const record = await PosSale.findByPk(saleId, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!record) throw httpError("Bill not found.", 404);
            if (record.status === "Voided") throw httpError("This bill has already been voided.", 409);
            if (req.user.role === "Employee" && String(record.created_by) !== String(req.user.id)) {
                throw httpError("Bill not found.", 404);
            }

            const approver = await verifyDiscountPin(pin, req.user.id, transaction);
            await VoidAudit.create({
                sale_id: record.pos_sale_id,
                requested_by_id: req.user.id,
                approved_by_id: approver.id,
                reason,
                previous_status: record.status,
                amount: record.total_amount,
            }, { transaction });
            await record.update({ status: "Voided" }, { transaction });
            return record;
        });

        return res.json({
            success: true,
            message: "Bill voided and recorded in the audit trail.",
            sale: await serializeSale(sale),
        });
    } catch (error) {
        return next(error);
    }
};

export const listRecentPosSales = async (req, res, next) => {
    try {
        const limit = Number(req.query.limit ?? 5);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw httpError("limit must be between 1 and 50.");
        const sales = await PosSale.findAll({
            where: req.user.role === "Employee" ? { created_by: req.user.id } : undefined,
            order: [["completed_at", "DESC"]],
            limit,
        });
        const serialized = [];
        for (const sale of sales) serialized.push(await serializeSale(sale));
        return res.json({ success: true, sales: serialized });
    } catch (error) {
        return next(error);
    }
};