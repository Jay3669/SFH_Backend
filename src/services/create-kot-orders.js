import { sequelize } from "../config/db.js";
import MenuItem from "../models/menu-item.model.js";
import KotItem from "../models/kot-item.model.js";
import KotOrder from "../models/kot-order.model.js";
import DiningTable from "../models/dining-table.model.js";
import { groupKotLinesByStation } from "./kot-orders.js";
import { emitKitchenEvent } from "./kitchen-socket.js";
import { serializeKot } from "./serialize-kot.js";

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

export async function createKotOrders({ fireKey, tableName, lines, createdBy = null, orderType = "Dine-in" }) {
    const createdKots = await sequelize.transaction(async (transaction) => {
        await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:fireKey))", {
            replacements: { fireKey },
            transaction,
        });
        const existing = await KotOrder.findAll({
            where: { fire_key: fireKey },
            order: [["kot_number", "ASC"]],
            transaction,
        });
        if (existing.length) {
            const result = [];
            for (const order of existing) result.push(await serializeKot(order, transaction));
            return result;
        }

        const menuItems = await MenuItem.findAll({
            where: {
                menu_item_id: lines.map((line) => line.menuItemId),
                is_available: true,
            },
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (menuItems.length !== new Set(lines.map((line) => line.menuItemId)).size) {
            throw httpError("One or more menu items are no longer available.", 409);
        }

        const menuById = new Map(menuItems.map((item) => [String(item.menu_item_id), item]));
        const stationGroups = groupKotLinesByStation(lines.map((line) => ({
            ...line,
            menuItem: menuById.get(line.menuItemId),
        })));

        await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:tableName))", {
            replacements: { tableName },
            transaction,
        });
        if (orderType === "Dine-in") {
            const [table] = await DiningTable.findOrCreate({
                where: { table_name: tableName },
                defaults: { status: "vacant" },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!["vacant", "occupied"].includes(table.status)) {
                throw httpError(`Table ${tableName} must be vacant before a new order can be fired.`, 409);
            }
            await table.update({ status: "occupied" }, { transaction });
        }

        const result = [];
        for (const { station, lines: stationLines } of stationGroups) {
            const order = await KotOrder.create({
                fire_key: fireKey,
                station,
                table_name: tableName,
                order_type: orderType,
                status: "pending",
                created_by: createdBy,
            }, { transaction });
            await KotItem.bulkCreate(stationLines.map((line) => ({
                kot_number: order.kot_number,
                menu_item_id: line.menuItem.menu_item_id,
                item_name: line.menuItem.name,
                quantity: line.quantity,
                notes: line.notes,
                status: "pending",
            })), { transaction });
            result.push(await serializeKot(order, transaction));
        }
        return result;
    });

    for (const kot of createdKots) emitKitchenEvent("kot:created", kot);
    return createdKots;
}
