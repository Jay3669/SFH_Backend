import { createHash } from "node:crypto";
import { Op } from "sequelize";
import MenuCategory from "../models/menu-category.model.js";
import MenuItem from "../models/menu-item.model.js";
import DiningTable from "../models/dining-table.model.js";
import { normalizeKotLines } from "../services/kot-orders.js";
import { createKotOrders } from "../services/create-kot-orders.js";
import { createTableOrderToken, readTableOrderToken } from "../services/table-order-token.js";

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

function verifyTableToken(token) {
    return readTableOrderToken(token);
}

export async function issueTableQrToken(req, res, next) {
    try {
        const tableName = String(req.body?.tableName || "").trim();
        if (!tableName || tableName.length > 64) throw httpError("tableName is required and must be at most 64 characters.");
        const table = await DiningTable.findOne({ where: { table_name: tableName } });
        if (!table) throw httpError("Dining table not found.", 404);
        const baseUrl = process.env.PUBLIC_ORDER_BASE_URL;
        if (!baseUrl) throw Object.assign(new Error("PUBLIC_ORDER_BASE_URL must be configured before QR codes can be generated."), { status: 503 });
        const urlBase = new URL(baseUrl);
        if (!["http:", "https:"].includes(urlBase.protocol)) throw Object.assign(new Error("PUBLIC_ORDER_BASE_URL must use HTTP or HTTPS."), { status: 503 });
        const token = createTableOrderToken(table.table_name);
        const url = new URL("/customer/order", baseUrl);
        url.searchParams.set("token", token);
        return res.json({ success: true, tableName: table.table_name, token, url: url.toString() });
    } catch (error) {
        return next(error);
    }
}

export async function getPublicOrderMenu(req, res, next) {
    try {
        const tableName = verifyTableToken(req.params.token);
        const [table, items, categories] = await Promise.all([
            DiningTable.findOne({ where: { table_name: tableName } }),
            MenuItem.findAll({
                where: { is_available: true },
                include: [{ association: "category", attributes: ["category_id", "category_name", "is_active"] }],
                order: [["name", "ASC"]],
            }),
            MenuCategory.findAll({ where: { is_active: true }, attributes: ["category_id", "category_name"] }),
        ]);
        if (!table) throw httpError("The table associated with this QR code no longer exists.", 404);
        const activeCategoryIds = new Set(categories.map((category) => String(category.category_id)));
        return res.json({
            success: true,
            tableName,
            categories,
            items: items.filter((item) => activeCategoryIds.has(String(item.category_id))).map((item) => ({
                id: String(item.menu_item_id),
                name: item.name,
                description: item.description || "",
                price: Number(item.price),
                imageUrl: item.image_url || "",
                foodType: item.food_type,
                categoryId: String(item.category_id),
                categoryName: item.category?.category_name || "",
            })),
        });
    } catch (error) {
        return next(error);
    }
}

export async function submitPublicOrder(req, res, next) {
    try {
        const tableName = verifyTableToken(req.params.token);
        const fireKey = String(req.get("Idempotency-Key") || "").trim();
        if (!fireKey || fireKey.length > 120) throw httpError("A valid Idempotency-Key header is required.");
        const lines = normalizeKotLines(req.body?.items);
        const menuItemIds = [...new Set(lines.map((line) => line.menuItemId))];
        const menuItems = await MenuItem.findAll({
            where: { menu_item_id: { [Op.in]: menuItemIds }, is_available: true },
            attributes: ["menu_item_id", "name", "price"],
        });
        if (menuItems.length !== menuItemIds.length) throw httpError("One or more selected items are no longer available.", 409);
        const fireDigest = createHash("sha256").update(fireKey).digest("hex");
        const kots = await createKotOrders({ fireKey: `QR-${fireDigest}`, tableName, lines });
        return res.status(201).json({
            success: true,
            orderNumber: kots[0]?.number || null,
            message: "Order sent to the kitchen. Please pay at the counter.",
        });
    } catch (error) {
        return next(error);
    }
}
