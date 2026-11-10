import { Op } from "sequelize";
import CashDrawer from "../models/cash-drawer.model.js";
import OrderPayment from "../models/order-payment.model.js";
import PosSale from "../models/pos-sale.model.js";
import PosSaleTender from "../models/pos-sale-tender.model.js";
import ShiftLog from "../models/shift-log.model.js";
import User from "../models/user.model.js";
import { sequelize } from "../config/db.js";
import { calculateCashCollected, calculateExpectedCash } from "../services/cash-drawers.js";

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

function positiveId(value, field) {
    if (!/^[1-9]\d*$/.test(String(value))) throw httpError(`${field} must be a positive integer.`);
    return String(value);
}

function money(value, field, { allowZero = true } = {}) {
    if (typeof value === "string" && !value.trim()) throw httpError(`${field} is required.`);
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount > 999999999999.99 || amount < (allowZero ? 0 : 0.01)
        || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
        throw httpError(`${field} must be a ${allowZero ? "non-negative" : "positive"} amount with at most two decimal places.`);
    }
    return Math.round(amount * 100) / 100;
}

function validDate(value) {
    return typeof value === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
        && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function currentBusinessDate() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

async function loadCashSales(drawer, endAt, transaction) {
    const sales = await PosSale.findAll({
        where: {
            created_by: drawer.cashier_id,
            completed_at: { [Op.gte]: drawer.opened_at, [Op.lte]: endAt },
            status: { [Op.notIn]: ["Cancelled", "Void", "cancelled", "void"] },
        },
        attributes: ["pos_sale_id", "payment_method", "amount_paid", "change_due"],
        transaction,
    });
    if (!sales.length) return 0;
    const saleIds = sales.map((sale) => sale.pos_sale_id);
    const [paymentRows, legacyRows] = await Promise.all([
        OrderPayment.findAll({ where: { order_id: { [Op.in]: saleIds } }, transaction }),
        PosSaleTender.findAll({ where: { sale_id: { [Op.in]: saleIds } }, transaction }),
    ]);
    const tendersBySale = new Map();
    for (const payment of paymentRows) {
        const saleId = String(payment.order_id);
        if (!tendersBySale.has(saleId)) tendersBySale.set(saleId, []);
        tendersBySale.get(saleId).push({ method: payment.payment_mode, amount: payment.amount });
    }
    for (const tender of legacyRows) {
        const saleId = String(tender.sale_id);
        if (tendersBySale.has(saleId)) continue;
        if (!tendersBySale.has(saleId)) tendersBySale.set(saleId, []);
        tendersBySale.get(saleId).push({ method: tender.method, amount: tender.amount });
    }
    return calculateCashCollected(sales, tendersBySale);
}

function serializeDrawer(drawer, cashSales, logs) {
    const logRows = logs.get(String(drawer.drawer_id)) || [];
    const movements = logRows
        .filter((log) => ["cash_in", "cash_out"].includes(log.event_type))
        .map((log) => ({
            id: String(log.shift_log_id),
            direction: log.event_type === "cash_in" ? "in" : "out",
            amount: Number(log.amount),
            description: log.description,
            at: log.createdAt,
        }));
    const expected = drawer.status === "closed"
        ? Number(drawer.expected_cash)
        : calculateExpectedCash(drawer.opening_balance, cashSales, movements);
    return {
        id: String(drawer.drawer_id),
        date: drawer.business_date,
        cashierId: String(drawer.cashier_id),
        cashierName: drawer.cashier
            ? [drawer.cashier.first_name, drawer.cashier.last_name].filter(Boolean).join(" ")
            : "",
        handedOverTo: drawer.handed_over_to ? String(drawer.handed_over_to) : null,
        handoverRecipientName: drawer.handoverRecipient
            ? [drawer.handoverRecipient.first_name, drawer.handoverRecipient.last_name].filter(Boolean).join(" ")
            : "",
        openingAmount: Number(drawer.opening_balance),
        openedAt: drawer.opened_at,
        status: drawer.status,
        movements,
        cashSales,
        expectedCash: expected,
        closingCount: drawer.actual_cash === null ? null : Number(drawer.actual_cash),
        actualCash: drawer.actual_cash === null ? null : Number(drawer.actual_cash),
        expectedAtClose: drawer.expected_cash === null ? null : Number(drawer.expected_cash),
        cashSalesAtClose: drawer.status === "closed" ? cashSales : null,
        variance: drawer.variance === null ? null : Number(drawer.variance),
        cashTaken: Number(drawer.cash_taken),
        closedAt: drawer.closed_at,
        logs: logRows.map((log) => ({
            id: String(log.shift_log_id),
            event: log.event_type,
            cashierId: String(log.cashier_id),
            targetCashierId: log.target_cashier_id ? String(log.target_cashier_id) : null,
            amount: log.amount === null ? null : Number(log.amount),
            expectedCash: log.expected_cash === null ? null : Number(log.expected_cash),
            actualCash: log.actual_cash === null ? null : Number(log.actual_cash),
            variance: log.variance === null ? null : Number(log.variance),
            description: log.description,
            at: log.createdAt,
        })),
    };
}

async function loadDrawerLogs(drawers, transaction) {
    if (!drawers.length) return new Map();
    const logs = await ShiftLog.findAll({
        where: { drawer_id: { [Op.in]: drawers.map((drawer) => drawer.drawer_id) } },
        order: [["createdAt", "ASC"], ["shift_log_id", "ASC"]],
        transaction,
    });
    const result = new Map();
    for (const log of logs) {
        const id = String(log.drawer_id);
        if (!result.has(id)) result.set(id, []);
        result.get(id).push(log);
    }
    return result;
}

async function loadDrawerSales(drawer, transaction) {
    return loadCashSales(drawer, drawer.closed_at || new Date(), transaction);
}

export const listCashDrawers = async (req, res, next) => {
    try {
        const drawers = await CashDrawer.findAll({
            where: { cashier_id: req.user.id },
            include: [
                { model: User, as: "cashier", attributes: ["first_name", "last_name"] },
                { model: User, as: "handoverRecipient", attributes: ["first_name", "last_name"] },
            ],
            order: [["opened_at", "DESC"]],
            limit: 30,
        });
        const logs = await loadDrawerLogs(drawers);
        const serialized = await Promise.all(drawers.map(async (drawer) => serializeDrawer(
            drawer,
            await loadDrawerSales(drawer),
            logs,
        )));
        return res.json({ success: true, drawers: serialized });
    } catch (error) {
        return next(error);
    }
};

export const listCashierOptions = async (req, res, next) => {
    try {
        const users = await User.findAll({
            where: {
                status: "active",
                role: { [Op.in]: ["Admin", "Manager", "Employee"] },
                id: { [Op.ne]: req.user.id },
            },
            attributes: ["id", "first_name", "last_name", "role"],
            order: [["first_name", "ASC"], ["last_name", "ASC"], ["id", "ASC"]],
        });
        return res.json({
            success: true,
            cashiers: users.map((user) => ({
                id: String(user.id),
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
            })),
        });
    } catch (error) {
        return next(error);
    }
};

export const openCashDrawer = async (req, res, next) => {
    try {
        const businessDate = req.body?.businessDate;
        if (!validDate(businessDate)) throw httpError("businessDate must be a valid YYYY-MM-DD date.");
        if (businessDate !== currentBusinessDate()) throw httpError("A cash drawer can only be opened for the current business date.");
        const openingBalance = money(req.body?.openingBalance, "openingBalance");
        const drawer = await sequelize.transaction(async (transaction) => {
            await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
            const existing = await CashDrawer.findOne({
                where: { cashier_id: req.user.id, status: "open" },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (existing) throw httpError("You already have an open cash drawer. Close or hand it over before starting another.", 409);
            const created = await CashDrawer.create({
                business_date: businessDate,
                cashier_id: req.user.id,
                opening_balance: openingBalance,
                status: "open",
                opened_at: new Date(),
            }, { transaction });
            await ShiftLog.create({
                drawer_id: created.drawer_id,
                cashier_id: req.user.id,
                event_type: "opened",
                amount: openingBalance,
                expected_cash: openingBalance,
                description: "Cash drawer opened.",
            }, { transaction });
            return created;
        });
        return res.status(201).json({ success: true, drawer: serializeDrawer(drawer, 0, new Map()) });
    } catch (error) {
        return next(error);
    }
};

export const addCashDrawerMovement = async (req, res, next) => {
    try {
        const drawerId = positiveId(req.params.drawerId, "drawerId");
        const amount = money(req.body?.amount, "amount", { allowZero: false });
        const direction = req.body?.direction;
        const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
        if (!["in", "out"].includes(direction)) throw httpError("direction must be in or out.");
        if (!description || description.length > 120) throw httpError("description is required and must be at most 120 characters.");
        const drawer = await sequelize.transaction(async (transaction) => {
            const current = await CashDrawer.findByPk(drawerId, { transaction, lock: transaction.LOCK.UPDATE });
            if (!current || String(current.cashier_id) !== String(req.user.id)) throw httpError("Cash drawer not found.", 404);
            if (current.status !== "open") throw httpError("This cash drawer is closed.", 409);
            const cashSales = await loadCashSales(current, new Date(), transaction);
            const logs = await ShiftLog.findAll({ where: { drawer_id: current.drawer_id }, transaction });
            const movements = logs
                .filter((log) => ["cash_in", "cash_out"].includes(log.event_type))
                .map((log) => ({ direction: log.event_type === "cash_in" ? "in" : "out", amount: log.amount }));
            const expected = calculateExpectedCash(current.opening_balance, cashSales, movements);
            if (direction === "out" && amount > expected) throw httpError("Cash paid out cannot exceed the expected cash in the drawer.");
            await ShiftLog.create({
                drawer_id: current.drawer_id,
                cashier_id: req.user.id,
                event_type: direction === "in" ? "cash_in" : "cash_out",
                amount,
                expected_cash: direction === "in" ? expected + amount : expected - amount,
                description,
            }, { transaction });
            return current;
        });
        return res.status(201).json({ success: true, drawerId: String(drawer.drawer_id) });
    } catch (error) {
        return next(error);
    }
};

export const closeCashDrawer = async (req, res, next) => {
    try {
        const drawerId = positiveId(req.params.drawerId, "drawerId");
        const actualCash = money(req.body?.actualCash, "actualCash");
        const cashTaken = money(req.body?.cashTaken ?? 0, "cashTaken");
        const drawer = await sequelize.transaction(async (transaction) => {
            const current = await CashDrawer.findByPk(drawerId, { transaction, lock: transaction.LOCK.UPDATE });
            if (!current || String(current.cashier_id) !== String(req.user.id)) throw httpError("Cash drawer not found.", 404);
            if (current.status !== "open") throw httpError("This cash drawer is already closed.", 409);
            if (cashTaken > actualCash) throw httpError("Cash taken out cannot exceed the physical cash count.");
            const closedAt = new Date();
            const cashSales = await loadCashSales(current, closedAt, transaction);
            const logs = await ShiftLog.findAll({ where: { drawer_id: current.drawer_id }, transaction });
            const movements = logs
                .filter((log) => ["cash_in", "cash_out"].includes(log.event_type))
                .map((log) => ({ direction: log.event_type === "cash_in" ? "in" : "out", amount: log.amount }));
            const expected = calculateExpectedCash(current.opening_balance, cashSales, movements);
            const variance = Math.round((actualCash - expected + Number.EPSILON) * 100) / 100;
            await current.update({
                status: "closed",
                actual_cash: actualCash,
                expected_cash: expected,
                variance,
                cash_taken: cashTaken,
                closed_at: closedAt,
            }, { transaction });
            const closingLog = await ShiftLog.create({
                drawer_id: current.drawer_id,
                cashier_id: req.user.id,
                event_type: "closed",
                amount: cashTaken,
                expected_cash: expected,
                actual_cash: actualCash,
                variance,
                description: "Cash drawer closed.",
            }, { transaction });
            return { drawer: current, cashSales, logs: [...logs, closingLog] };
        });
        return res.json({
            success: true,
            drawer: serializeDrawer(drawer.drawer, drawer.cashSales, new Map([[String(drawer.drawer.drawer_id), drawer.logs]])),
        });
    } catch (error) {
        return next(error);
    }
};

export const handoverCashDrawer = async (req, res, next) => {
    try {
        const drawerId = positiveId(req.params.drawerId, "drawerId");
        const actualCash = money(req.body?.actualCash, "actualCash");
        const cashTaken = money(req.body?.cashTaken ?? 0, "cashTaken");
        const nextCashierId = String(req.body?.nextCashierId || "");
        if (!/^[1-9]\d*$/.test(nextCashierId)) throw httpError("nextCashierId must be a positive integer.");
        const result = await sequelize.transaction(async (transaction) => {
            const current = await CashDrawer.findByPk(drawerId, { transaction, lock: transaction.LOCK.UPDATE });
            if (!current || String(current.cashier_id) !== String(req.user.id)) throw httpError("Cash drawer not found.", 404);
            if (current.status !== "open") throw httpError("This cash drawer is already closed.", 409);
            if (String(req.user.id) === nextCashierId) throw httpError("Choose a different cashier for handover.");
            if (cashTaken > actualCash) throw httpError("Cash taken out cannot exceed the physical cash count.");
            const lockedUsers = new Map();
            for (const id of [String(req.user.id), nextCashierId].sort((left, right) => Number(left) - Number(right))) {
                lockedUsers.set(id, await User.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }));
            }
            const nextCashier = lockedUsers.get(nextCashierId);
            if (!nextCashier || nextCashier.status !== "active" || !["Admin", "Manager", "Employee"].includes(nextCashier.role)) {
                throw httpError("The selected handover cashier is not an active staff member.");
            }
            const existing = await CashDrawer.findOne({
                where: { cashier_id: nextCashierId, status: "open" },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (existing) throw httpError("The selected cashier already has an open drawer.", 409);
            const closedAt = new Date();
            const cashSales = await loadCashSales(current, closedAt, transaction);
            const logs = await ShiftLog.findAll({ where: { drawer_id: current.drawer_id }, transaction });
            const movements = logs
                .filter((log) => ["cash_in", "cash_out"].includes(log.event_type))
                .map((log) => ({ direction: log.event_type === "cash_in" ? "in" : "out", amount: log.amount }));
            const expected = calculateExpectedCash(current.opening_balance, cashSales, movements);
            const variance = Math.round((actualCash - expected + Number.EPSILON) * 100) / 100;
            const nextOpening = Math.round((actualCash - cashTaken + Number.EPSILON) * 100) / 100;
            await current.update({
                status: "closed",
                actual_cash: actualCash,
                expected_cash: expected,
                variance,
                cash_taken: cashTaken,
                closed_at: closedAt,
                handed_over_to: nextCashierId,
            }, { transaction });
            await ShiftLog.create({
                drawer_id: current.drawer_id,
                cashier_id: req.user.id,
                target_cashier_id: nextCashierId,
                event_type: "handed_over",
                amount: nextOpening,
                expected_cash: expected,
                actual_cash: actualCash,
                variance,
                description: `Shift handed over to ${nextCashier.first_name} ${nextCashier.last_name || ""}`.trim(),
            }, { transaction });
            const nextDrawer = await CashDrawer.create({
                business_date: current.business_date,
                cashier_id: nextCashierId,
                opening_balance: nextOpening,
                status: "open",
                opened_at: closedAt,
            }, { transaction });
            await ShiftLog.create({
                drawer_id: nextDrawer.drawer_id,
                cashier_id: req.user.id,
                target_cashier_id: nextCashierId,
                event_type: "handover_received",
                amount: nextOpening,
                expected_cash: nextOpening,
                description: `Received drawer handover from ${req.user.first_name} ${req.user.last_name || ""}`.trim(),
            }, { transaction });
            return { current, nextDrawer, cashSales, expected, nextCashier };
        });
        const logs = await loadDrawerLogs([result.current, result.nextDrawer]);
        return res.json({
            success: true,
            drawer: serializeDrawer(result.current, result.cashSales, logs),
            nextDrawer: serializeDrawer(result.nextDrawer, 0, logs),
        });
    } catch (error) {
        return next(error);
    }
};

CashDrawer.belongsTo(User, { as: "cashier", foreignKey: "cashier_id" });
CashDrawer.belongsTo(User, { as: "handoverRecipient", foreignKey: "handed_over_to" });
