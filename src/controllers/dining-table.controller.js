import { Op } from "sequelize";
import { randomUUID } from "node:crypto";
import { sequelize } from "../config/db.js";
import DiningTable from "../models/dining-table.model.js";
import KotOrder from "../models/kot-order.model.js";
import KotItem from "../models/kot-item.model.js";
import TableTransfer from "../models/table-transfer.model.js";
import { emitKitchenEvent } from "../services/kitchen-socket.js";
import { serializeKot } from "../services/serialize-kot.js";
import {
    assertTableStatusTransition,
    assertTableTransferAllowed,
    normalizeTableName,
} from "../services/table-management.js";

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

function serializeTable(table, kots = []) {
    return {
        id: String(table.dining_table_id),
        tableName: table.table_name,
        status: table.status,
        kots,
    };
}

export const listDiningTables = async (req, res, next) => {
    try {
        const tables = await DiningTable.findAll({ order: [["table_name", "ASC"]] });
        const names = tables.map((table) => table.table_name);
        const orders = names.length ? await KotOrder.findAll({
            where: { table_name: names, status: { [Op.ne]: "served" } },
            order: [["createdAt", "ASC"], ["kot_number", "ASC"]],
        }) : [];
        const kotsByTable = new Map(names.map((name) => [name, []]));
        for (const order of orders) {
            kotsByTable.get(order.table_name)?.push(await serializeKot(order));
        }
        return res.json({
            success: true,
            tables: tables.map((table) => serializeTable(table, kotsByTable.get(table.table_name))),
        });
    } catch (error) {
        return next(error);
    }
};

export const createDiningTable = async (req, res, next) => {
    try {
        const tableName = normalizeTableName(req.body?.tableName);
        const table = await DiningTable.create({ table_name: tableName, status: "vacant" });
        return res.status(201).json({ success: true, table: serializeTable(table) });
    } catch (error) {
        return next(error);
    }
};

async function transferTables(req, res, action, next) {
    let updatedKots;
    try {
        const sourceName = normalizeTableName(req.params.tableName, "sourceTable");
        const destinationName = normalizeTableName(req.body?.destinationTable, "destinationTable");
        const requestedItemIds = req.body?.itemIds;
        if (
            requestedItemIds !== undefined
            && (!Array.isArray(requestedItemIds)
                || requestedItemIds.length === 0
                || requestedItemIds.some((id) => !/^[1-9]\d*$/.test(String(id))))
        ) {
            throw httpError("itemIds must be a non-empty array of positive KOT item IDs.");
        }
        const selectedItemIds = requestedItemIds === undefined
            ? null
            : new Set(requestedItemIds.map(String));
        if (sourceName.toLocaleLowerCase() === destinationName.toLocaleLowerCase()) {
            throw httpError("Source and destination tables must be different.");
        }
        updatedKots = await sequelize.transaction(async (transaction) => {
            const names = [sourceName, destinationName].sort((a, b) => a.localeCompare(b));
            const tables = await DiningTable.findAll({
                where: { table_name: names },
                order: [["table_name", "ASC"]],
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            const source = tables.find((table) => table.table_name === sourceName);
            const destination = tables.find((table) => table.table_name === destinationName);
            if (!source || !destination) throw httpError("Both source and destination tables must exist.", 404);
            assertTableTransferAllowed(action, source.status, destination.status);

            const orders = await KotOrder.findAll({
                where: { table_name: sourceName, status: { [Op.ne]: "served" } },
                order: [["kot_number", "ASC"]],
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!orders.length) throw httpError("The source table has no active kitchen orders.", 409);

            const items = await KotItem.findAll({
                where: { kot_number: orders.map((order) => order.kot_number) },
                order: [["kot_item_id", "ASC"]],
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            const sourceItemIds = new Set(items.map((item) => String(item.kot_item_id)));
            if (selectedItemIds) {
                const invalidIds = [...selectedItemIds].filter((id) => !sourceItemIds.has(id));
                if (invalidIds.length) throw httpError("Every selected KOT item must belong to an active order at the source table.");
            }

            const movedOrders = [];
            const changedOrders = [];
            for (const order of orders) {
                const orderItems = items.filter((item) => String(item.kot_number) === String(order.kot_number));
                const itemsToMove = selectedItemIds
                    ? orderItems.filter((item) => selectedItemIds.has(String(item.kot_item_id)))
                    : orderItems;
                if (!itemsToMove.length) continue;

                if (itemsToMove.length === orderItems.length) {
                    await order.update({ table_name: destinationName }, { transaction });
                    movedOrders.push(order);
                    changedOrders.push(order);
                    continue;
                }

                const destinationOrder = await KotOrder.create({
                    fire_key: `transfer-${randomUUID()}`,
                    station: order.station,
                    table_name: destinationName,
                    status: order.status,
                    created_by: order.created_by,
                    createdAt: order.createdAt,
                }, { transaction });
                await KotItem.update(
                    { kot_number: destinationOrder.kot_number },
                    {
                        where: { kot_item_id: itemsToMove.map((item) => item.kot_item_id) },
                        transaction,
                    },
                );
                movedOrders.push(destinationOrder);
                changedOrders.push(order, destinationOrder);
            }
            if (!movedOrders.length) throw httpError("Select at least one active KOT item to transfer.");

            const remainingOrders = await KotOrder.count({
                where: { table_name: sourceName, status: { [Op.ne]: "served" } },
                transaction,
            });
            if (!remainingOrders) await source.update({ status: "vacant" }, { transaction });
            if (action === "move") await destination.update({ status: "occupied" }, { transaction });
            await TableTransfer.create({
                action,
                source_table: sourceName,
                destination_table: destinationName,
                kot_numbers: movedOrders.map((order) => String(order.kot_number)),
                performed_by: req.user?.id || null,
            }, { transaction });

            return Promise.all(changedOrders.map(async (order) => {
                return serializeKot(order, transaction);
            }));
        });

        for (const kot of updatedKots) emitKitchenEvent("kot:updated", kot);
        return res.json({ success: true, action, kots: updatedKots });
    } catch (error) {
        return next(error);
    }
}

export const moveDiningTable = (req, res, next) => transferTables(req, res, "move", next);
export const mergeDiningTables = (req, res, next) => transferTables(req, res, "merge", next);

export const updateDiningTableStatus = async (req, res, next) => {
    try {
        const tableName = normalizeTableName(req.params.tableName);
        const nextStatus = req.body?.status;
        const table = await sequelize.transaction(async (transaction) => {
            const record = await DiningTable.findOne({
                where: { table_name: tableName },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!record) throw httpError("Table not found.", 404);
            assertTableStatusTransition(record.status, nextStatus);
            const activeKotCount = await KotOrder.count({
                where: { table_name: tableName, status: { [Op.ne]: "served" } },
                transaction,
            });
            if (nextStatus !== "occupied" && activeKotCount) {
                throw httpError("Active kitchen orders must be served before changing this table status.", 409);
            }
            await record.update({ status: nextStatus }, { transaction });
            return serializeTable(record);
        });
        emitKitchenEvent(nextStatus === "dirty/cleaning" ? "table:settled" : "table:status", { table });
        return res.json({ success: true, table });
    } catch (error) {
        return next(error);
    }
};
