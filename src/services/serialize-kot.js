import KotItem from "../models/kot-item.model.js";
import { formatKotNumber } from "./kot-orders.js";

export async function serializeKot(order, transaction) {
    const items = await KotItem.findAll({
        where: { kot_number: order.kot_number },
        order: [["kot_item_id", "ASC"]],
        transaction,
    });
    return {
        id: String(order.kot_number),
        sequence: String(order.kot_number),
        number: formatKotNumber(order.kot_number),
        station: order.station,
        tableName: order.table_name,
        orderType: order.order_type || "Dine-in",
        status: order.status,
        createdAt: order.createdAt,
        items: items.map((item) => ({
            id: String(item.kot_item_id),
            menuItemId: item.menu_item_id ? String(item.menu_item_id) : null,
            name: item.item_name,
            quantity: Number(item.quantity),
            notes: item.notes || "",
            status: item.status,
        })),
    };
}
