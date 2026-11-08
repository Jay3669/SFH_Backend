import { Op } from "sequelize";
import { sequelize } from "../config/db.js";
import InventoryBatch from "../models/inventory-batch.model.js";
import InventoryCategory from "../models/inventory-category.model.js";
import InventoryItem from "../models/inventory-item.model.js";
import InventoryMovement from "../models/inventory-movement.model.js";
import InventoryPayment from "../models/inventory-payment.model.js";
import InventoryPurchase from "../models/inventory-purchase.model.js";
import InventoryRecipe from "../models/inventory-recipe.model.js";
import InventorySupplier from "../models/inventory-supplier.model.js";
import { unitCostFromTotal } from "../services/inventory-costs.js";
import { convertQuantity } from "../services/recipe-units.js";

const defaultCategories = [
    "Vegetables", "Fruits", "Meat & poultry", "Seafood", "Dairy", "Grains",
    "Spices", "Oils", "Beverages", "Packaging", "Cleaning",
];
const movementTypes = new Set([
    "Purchase received", "Kitchen consumption", "Wastage", "Damage", "Supplier return",
    "Expired", "Stock correction",
]);
const paymentTerms = new Set(["Due on receipt", "Net 7 days", "Net 15 days", "Net 30 days"]);

function badRequest(message) {
    return Object.assign(new Error(message), { status: 400 });
}

function notFound(message) {
    return Object.assign(new Error(message), { status: 404 });
}

function validateId(value, field = "id") {
    if (!/^[1-9]\d*$/.test(String(value))) throw badRequest(`${field} must be a positive integer.`);
    return String(value);
}

async function findCategory(value, transaction, lock = false) {
    const category = /^[1-9]\d*$/.test(String(value))
        ? await InventoryCategory.findByPk(String(value), { transaction, ...(lock ? { lock: transaction.LOCK.UPDATE } : {}) })
        : await InventoryCategory.findOne({ where: { name: String(value) }, transaction, ...(lock ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (!category) throw notFound("Inventory category not found.");
    return category;
}

function text(value, field, max = 160, { optional = false } = {}) {
    if (optional && (value === undefined || value === null || value === "")) return null;
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
        throw badRequest(`${field} is required and must be at most ${max} characters.`);
    }
    return value.trim();
}

function number(value, field, { min = 0, allowZero = true, decimals = 3 } = {}) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < min || (!allowZero && parsed === 0)) {
        throw badRequest(`${field} must be a valid number ${allowZero ? "at least" : "greater than"} ${min}.`);
    }
    const precision = 10 ** decimals;
    if (Math.abs(parsed * precision - Math.round(parsed * precision)) > 1e-7) {
        throw badRequest(`${field} supports at most ${decimals} decimal places.`);
    }
    return parsed;
}

function dateOnly(value, field = "expiry") {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw badRequest(`${field} must use YYYY-MM-DD format.`);
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw badRequest(`${field} must be a valid date.`);
    }
    return value;
}

function idOf(record, key) {
    return String(record[key]);
}

function quantityOf(record) {
    return Number(record.quantity);
}

function recipeQuantityInStockUnits(quantity, recipeUnit, stockUnit) {
    const converted = convertQuantity(quantity, recipeUnit, stockUnit);
    if (Math.abs(converted * 1000 - Math.round(converted * 1000)) > 1e-7) {
        throw badRequest(`The converted recipe quantity exceeds the inventory precision of 0.001 ${stockUnit}.`);
    }
    return converted;
}

function createBatchCode(prefix = "BATCH") {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function findItem(id, transaction, lock = false) {
    const item = await InventoryItem.findByPk(validateId(id, "itemId"), {
        transaction,
        ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
    });
    if (!item) throw notFound("Inventory item not found.");
    return item;
}

async function findBatches(itemId, transaction, lock = false) {
    return InventoryBatch.findAll({
        where: { item_id: itemId, quantity: { [Op.gt]: 0 } },
        order: [["received_at", "ASC"], ["expiry_date", "ASC"], ["inventory_batch_id", "ASC"]],
        transaction,
        ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
    });
}

async function addMovement(item, values, transaction) {
    return InventoryMovement.create({
        item_id: item.inventory_item_id,
        movement_type: values.type,
        quantity: values.quantity,
        unit_cost_snapshot: values.unitCost ?? null,
        total_cost_snapshot: values.totalCost ?? (values.unitCost === undefined ? null : values.quantity * values.unitCost),
        reason: values.reason,
        batch_code: values.batch || null,
        expiry_date: values.expiry || null,
    }, { transaction });
}

async function consumeStock(item, amount, transaction, batchCode = null) {
    const batches = await findBatches(item.inventory_item_id, transaction, true);
    let remaining = amount;
    let consumedCost = 0;
    if (batchCode) {
        const selected = batches.find((batch) => batch.batch_code === batchCode);
        if (!selected) throw badRequest(`Batch ${batchCode} has no available stock.`);
        if (quantityOf(selected) + 0.000001 < remaining) {
            throw badRequest(`Only ${quantityOf(selected)} units remain in batch ${batchCode}.`);
        }
        await selected.update({ quantity: quantityOf(selected) - remaining }, { transaction });
        return remaining * Number(selected.unit_cost);
    }
    for (const batch of batches) {
        if (remaining <= 0) break;
        const consumed = Math.min(quantityOf(batch), remaining);
        if (consumed > 0) {
            await batch.update({ quantity: quantityOf(batch) - consumed }, { transaction });
            consumedCost += consumed * Number(batch.unit_cost);
            remaining -= consumed;
        }
    }
    if (remaining > 0.000001) throw badRequest("Not enough available stock to complete this movement.");
    return consumedCost;
}

function serializeBatch(batch) {
    return {
        id: batch.batch_code,
        quantity: quantityOf(batch),
        cost: Number(batch.unit_cost),
        expiry: batch.expiry_date || "",
        receivedAt: new Date(batch.received_at).getTime(),
    };
}

function serializeMovement(movement, unit) {
    const createdAt = new Date(movement.createdAt);
    return {
        type: movement.movement_type,
        quantity: Number(movement.quantity),
        unit,
        reason: movement.reason,
        date: createdAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }),
        timestamp: createdAt.getTime(),
        batch: movement.batch_code || "",
        expiry: movement.expiry_date || "",
    };
}

function serializeItem(item, categories, batchesByItem, movementsByItem) {
    const batches = batchesByItem.get(String(item.inventory_item_id)) || [];
    return {
        id: idOf(item, "inventory_item_id"),
        name: item.name,
        category: categories.get(String(item.category_id)) || "",
        quantity: Number(item.quantity),
        unit: item.unit,
        reorderLevel: Number(item.reorder_level),
        cost: Number(item.unit_cost),
        batch: batches[0]?.id || "",
        expiry: batches.find((batch) => batch.expiry)?.expiry || "",
        batches,
        movements: movementsByItem.get(String(item.inventory_item_id)) || [],
    };
}

function serializePurchase(purchase) {
    const total = Number(purchase.quantity) * Number(purchase.unit_price);
    const paidAmount = Number(purchase.paid_amount);
    return {
        id: purchase.order_number,
        purchaseId: idOf(purchase, "inventory_purchase_id"),
        supplierId: idOf(purchase, "supplier_id"),
        supplier: purchase.supplier_name,
        itemId: idOf(purchase, "item_id"),
        item: purchase.item_name,
        quantity: Number(purchase.quantity),
        receivedQuantity: Number(purchase.received_quantity),
        unit: purchase.unit,
        unitPrice: Number(purchase.unit_price),
        date: purchase.order_date,
        status: purchase.status,
        invoice: purchase.invoice_reference,
        paidAmount,
        due: purchase.status === "Cancelled" ? 0 : Math.max(0, total - paidAmount),
        expiry: purchase.expiry_date || "",
    };
}

async function loadInventorySnapshot() {
    const [categories, items, suppliers, purchases, recipes, batches, movements] = await Promise.all([
        InventoryCategory.findAll({ order: [["name", "ASC"]] }),
        InventoryItem.findAll({ order: [["name", "ASC"]] }),
        InventorySupplier.findAll({ order: [["name", "ASC"]] }),
        InventoryPurchase.findAll({ order: [["createdAt", "DESC"]] }),
        InventoryRecipe.findAll({ order: [["dish_name", "ASC"], ["inventory_recipe_id", "ASC"]] }),
        InventoryBatch.findAll({ order: [["received_at", "DESC"]] }),
        InventoryMovement.findAll({ order: [["createdAt", "DESC"]], limit: 5000 }),
    ]);
    const categoryNames = new Map(categories.map((category) => [String(category.inventory_category_id), category.name]));
    const batchesByItem = new Map();
    for (const batch of batches) {
        const itemId = String(batch.item_id);
        if (!batchesByItem.has(itemId)) batchesByItem.set(itemId, []);
        batchesByItem.get(itemId).push(serializeBatch(batch));
    }
    const itemsById = new Map(items.map((item) => [String(item.inventory_item_id), item]));
    const movementsByItem = new Map();
    for (const movement of movements) {
        const itemId = String(movement.item_id);
        const item = itemsById.get(itemId);
        if (!item) continue;
        if (!movementsByItem.has(itemId)) movementsByItem.set(itemId, []);
        movementsByItem.get(itemId).push(serializeMovement(movement, item.unit));
    }
    return {
        categories: categories.map((category) => category.name),
        categoryDetails: categories.map((category) => ({
            id: idOf(category, "inventory_category_id"),
            name: category.name,
            description: category.description || "",
        })),
        items: items.map((item) => serializeItem(item, categoryNames, batchesByItem, movementsByItem)),
        suppliers: suppliers.map((supplier) => ({
            id: idOf(supplier, "inventory_supplier_id"),
            name: supplier.name,
            contact: supplier.contact_person,
            phone: supplier.phone,
            email: supplier.email || "",
            terms: supplier.payment_terms,
            active: supplier.is_active,
        })),
        purchases: purchases.map(serializePurchase),
        recipes: recipes.map((recipe) => ({
            id: idOf(recipe, "inventory_recipe_id"),
            dish: recipe.dish_name,
            itemId: idOf(recipe, "item_id"),
            quantity: Number(recipe.quantity_per_serving),
            unit: itemsById.get(String(recipe.item_id))?.unit || "",
        })),
    };
}

export const getInventory = async (req, res, next) => {
    try {
        await Promise.all(defaultCategories.map((name) =>
            InventoryCategory.findOrCreate({ where: { name }, defaults: { name } })
        ));
        return res.json({ success: true, inventory: await loadInventorySnapshot() });
    } catch (error) {
        return next(error);
    }
};

export const getCategories = async (req, res, next) => {
    try {
        await Promise.all(defaultCategories.map((name) =>
            InventoryCategory.findOrCreate({ where: { name }, defaults: { name } })
        ));
        const categories = await InventoryCategory.findAll({ order: [["name", "ASC"]] });
        return res.json({
            success: true,
            categories: categories.map((category) => ({
                id: idOf(category, "inventory_category_id"),
                name: category.name,
                description: category.description || "",
            })),
        });
    } catch (error) {
        return next(error);
    }
};

export const getCategoryById = async (req, res, next) => {
    try {
        const id = validateId(req.params.id, "categoryId");
        const category = await InventoryCategory.findByPk(id);
        if (!category) throw notFound("Inventory category not found.");
        return res.json({
            success: true,
            category: {
                id: idOf(category, "inventory_category_id"),
                name: category.name,
                description: category.description || "",
            },
        });
    } catch (error) {
        return next(error);
    }
};

export const createCategory = async (req, res, next) => {
    try {
        const name = text(req.body?.name, "name", 100);
        const description = text(req.body?.description, "description", 2000, { optional: true });
        const category = await InventoryCategory.create({ name, description });
        return res.status(201).json({
            success: true,
            message: "Category created.",
            category: { id: idOf(category, "inventory_category_id"), name, description: category.description || "" },
        });
    } catch (error) {
        return next(error);
    }
};

export const updateCategory = async (req, res, next) => {
    try {
        const name = text(req.body?.name, "name", 100);
        const description = req.body?.description === undefined
            ? undefined
            : text(req.body.description, "description", 2000, { optional: true });
        const category = await findCategory(req.params.id);
        await category.update({ name, ...(description === undefined ? {} : { description }) });
        return res.json({
            success: true,
            category: { id: idOf(category, "inventory_category_id"), name, description: category.description || "" },
        });
    } catch (error) {
        return next(error);
    }
};

export const deleteCategory = async (req, res, next) => {
    try {
        const categoryId = req.params.id;
        const replacementName = req.body?.replacementCategory;
        await sequelize.transaction(async (transaction) => {
            const category = await findCategory(categoryId, transaction, true);
            const linkedCount = await InventoryItem.count({ where: { category_id: category.inventory_category_id }, transaction });
            if (linkedCount && typeof replacementName !== "string") {
                throw badRequest("Choose a destination category for the linked stock items.");
            }
            if (linkedCount) {
                const replacement = await InventoryCategory.findOne({
                    where: { name: replacementName.trim(), inventory_category_id: { [Op.ne]: category.inventory_category_id } },
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });
                if (!replacement) throw badRequest("Choose a valid destination category.");
                await InventoryItem.update({ category_id: replacement.inventory_category_id }, {
                    where: { category_id: category.inventory_category_id },
                    transaction,
                });
            }
            await category.destroy({ transaction });
        });
        return res.json({ success: true, message: "Category deleted." });
    } catch (error) {
        return next(error);
    }
};

export const createItem = async (req, res, next) => {
    try {
        const name = text(req.body?.name, "name");
        const categoryName = text(req.body?.category, "category", 100);
        const unit = text(req.body?.unit, "unit", 24);
        const quantity = number(req.body?.quantity, "quantity");
        const reorderLevel = number(req.body?.reorderLevel, "reorderLevel");
        const openingTotalCost = req.body?.openingTotalCost === undefined
            ? undefined
            : number(req.body.openingTotalCost, "openingTotalCost", { decimals: 2 });
        const cost = openingTotalCost === undefined
            ? number(req.body?.cost, "cost", { decimals: 2 })
            : unitCostFromTotal(openingTotalCost, quantity);
        if (quantity === 0 && openingTotalCost !== undefined && openingTotalCost !== 0) {
            throw badRequest("Opening stock total cost must be zero when opening stock quantity is zero.");
        }
        const expiry = dateOnly(req.body?.expiry);
        const category = await InventoryCategory.findOne({ where: { name: categoryName } });
        if (!category) throw badRequest("Choose a valid inventory category.");
        const item = await sequelize.transaction(async (transaction) => {
            const created = await InventoryItem.create({
                category_id: category.inventory_category_id,
                name,
                unit,
                quantity: 0,
                reorder_level: reorderLevel,
                unit_cost: cost,
            }, { transaction });
            if (quantity > 0) {
                const code = createBatchCode("OPEN");
                await InventoryBatch.create({
                    item_id: created.inventory_item_id, batch_code: code, quantity,
                    unit_cost: cost, expiry_date: expiry, received_at: new Date(),
                }, { transaction });
                await created.update({ quantity }, { transaction });
                await addMovement(created, { type: "Opening stock", quantity, unitCost: cost, reason: "Opening balance", batch: code, expiry }, transaction);
            }
            return created;
        });
        return res.status(201).json({ success: true, itemId: idOf(item, "inventory_item_id") });
    } catch (error) {
        return next(error);
    }
};

export const updateItem = async (req, res, next) => {
    try {
        const id = validateId(req.params.id);
        const name = text(req.body?.name, "name");
        const categoryName = text(req.body?.category, "category", 100);
        const reorderLevel = number(req.body?.reorderLevel, "reorderLevel");
        const category = await InventoryCategory.findOne({ where: { name: categoryName } });
        if (!category) throw badRequest("Choose a valid inventory category.");
        const item = await findItem(id);
        await item.update({ name, category_id: category.inventory_category_id, reorder_level: reorderLevel });
        return res.json({ success: true, message: "Inventory item updated." });
    } catch (error) {
        return next(error);
    }
};

export const recordMovement = async (req, res, next) => {
    try {
        const itemId = validateId(req.params.id, "itemId");
        const type = text(req.body?.type, "type", 40);
        if (!movementTypes.has(type)) throw badRequest("Unsupported stock movement type.");
        const reason = text(req.body?.reason, "reason", 2000);
        const expiry = dateOnly(req.body?.expiry);
        const requestedBatch = typeof req.body?.batch === "string" ? req.body.batch.trim() : "";
        const item = await sequelize.transaction(async (transaction) => {
            const locked = await findItem(itemId, transaction, true);
            const currentQuantity = Number(locked.quantity);
            const amount = number(req.body?.quantity, "quantity", { allowZero: false });
            if (type === "Stock correction") {
                const variance = amount - currentQuantity;
                if (Math.abs(variance) < 0.000001) throw badRequest("The physical count matches the system balance; no correction is needed.");
                if (variance > 0) {
                    const batchCode = requestedBatch || createBatchCode("ADJ");
                    await InventoryBatch.create({
                        item_id: locked.inventory_item_id, batch_code: batchCode, quantity: variance,
                        unit_cost: Number(locked.unit_cost), expiry_date: expiry, received_at: new Date(),
                    }, { transaction });
                    await addMovement(locked, { type, quantity: variance, unitCost: Number(locked.unit_cost), reason: `${reason} · physical count ${amount} ${locked.unit}; variance +${variance} ${locked.unit}`, batch: batchCode, expiry }, transaction);
                } else {
                    const consumedCost = await consumeStock(locked, Math.abs(variance), transaction);
                    await addMovement(locked, { type, quantity: Math.abs(variance), unitCost: consumedCost / Math.abs(variance), totalCost: consumedCost, reason: `${reason} · physical count ${amount} ${locked.unit}; variance ${variance} ${locked.unit}` }, transaction);
                }
                await locked.update({ quantity: amount }, { transaction });
            } else if (type === "Purchase received") {
                const batchCode = requestedBatch || createBatchCode();
                await InventoryBatch.create({
                    item_id: locked.inventory_item_id, batch_code: batchCode, quantity: amount,
                    unit_cost: Number(locked.unit_cost), expiry_date: expiry, received_at: new Date(),
                }, { transaction });
                await locked.update({ quantity: currentQuantity + amount }, { transaction });
                await addMovement(locked, { type, quantity: amount, unitCost: Number(locked.unit_cost), reason, batch: batchCode, expiry }, transaction);
            } else {
                const consumedCost = await consumeStock(locked, amount, transaction, requestedBatch || null);
                await locked.update({ quantity: currentQuantity - amount }, { transaction });
                await addMovement(locked, { type, quantity: amount, unitCost: consumedCost / amount, totalCost: consumedCost, reason, batch: requestedBatch || "FIFO allocation", expiry }, transaction);
            }
            return locked;
        });
        return res.status(201).json({ success: true, quantity: Number(item.quantity) });
    } catch (error) {
        return next(error);
    }
};

export const updateBatchExpiry = async (req, res, next) => {
    try {
        const itemId = validateId(req.params.id, "itemId");
        const code = text(req.params.batchCode, "batchCode", 100);
        const expiry = dateOnly(req.body?.expiry);
        const batch = await InventoryBatch.findOne({ where: { item_id: itemId, batch_code: code } });
        if (!batch) throw notFound("Stock batch not found.");
        await batch.update({ expiry_date: expiry });
        return res.json({ success: true });
    } catch (error) {
        return next(error);
    }
};

export const createSupplier = async (req, res, next) => {
    try {
        const name = text(req.body?.name, "name");
        const contactPerson = text(req.body?.contact, "contact");
        const phone = text(req.body?.phone, "phone", 40);
        const email = text(req.body?.email, "email", 254, { optional: true });
        const terms = text(req.body?.terms, "terms", 40);
        if (!paymentTerms.has(terms)) throw badRequest("Choose valid payment terms.");
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("email must be a valid email address.");
        const supplier = await InventorySupplier.create({
            name, contact_person: contactPerson, phone, email, payment_terms: terms,
        });
        return res.status(201).json({ success: true, supplierId: idOf(supplier, "inventory_supplier_id") });
    } catch (error) {
        return next(error);
    }
};

export const updateSupplier = async (req, res, next) => {
    try {
        const id = validateId(req.params.id);
        const name = text(req.body?.name, "name");
        const contactPerson = text(req.body?.contact, "contact");
        const phone = text(req.body?.phone, "phone", 40);
        const email = text(req.body?.email, "email", 254, { optional: true });
        const terms = text(req.body?.terms, "terms", 40);
        if (!paymentTerms.has(terms)) throw badRequest("Choose valid payment terms.");
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("email must be a valid email address.");
        const supplier = await InventorySupplier.findByPk(id);
        if (!supplier) throw notFound("Supplier not found.");
        await supplier.update({ name, contact_person: contactPerson, phone, email, payment_terms: terms });
        return res.json({ success: true });
    } catch (error) {
        return next(error);
    }
};

export const setSupplierActive = async (req, res, next) => {
    try {
        const id = validateId(req.params.id);
        if (typeof req.body?.active !== "boolean") throw badRequest("active must be a boolean.");
        const supplier = await InventorySupplier.findByPk(id);
        if (!supplier) throw notFound("Supplier not found.");
        await supplier.update({ is_active: req.body.active });
        return res.json({ success: true });
    } catch (error) {
        return next(error);
    }
};

export const deleteSupplier = async (req, res, next) => {
    try {
        const id = validateId(req.params.id);
        let archived = false;
        await sequelize.transaction(async (transaction) => {
            const supplier = await InventorySupplier.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!supplier) throw notFound("Supplier not found.");
            const purchaseCount = await InventoryPurchase.count({ where: { supplier_id: id }, transaction });
            if (purchaseCount) {
                await supplier.update({ is_active: false }, { transaction });
                archived = true;
            } else {
                await supplier.destroy({ transaction });
            }
        });
        return res.json({ success: true, archived });
    } catch (error) {
        return next(error);
    }
};

export const createPurchase = async (req, res, next) => {
    try {
        const supplierId = validateId(req.body?.supplierId, "supplierId");
        const itemId = validateId(req.body?.itemId, "itemId");
        const quantity = number(req.body?.quantity, "quantity", { allowZero: false });
        const unitPrice = number(req.body?.unitPrice, "unitPrice", { decimals: 2 });
        const invoice = text(req.body?.invoice, "invoice", 120);
        const expiry = dateOnly(req.body?.expiry);
        const [supplier, item] = await Promise.all([
            InventorySupplier.findByPk(supplierId),
            InventoryItem.findByPk(itemId),
        ]);
        if (!supplier || !supplier.is_active) throw badRequest("Choose an active supplier.");
        if (!item) throw badRequest("Choose a valid inventory item.");
        const purchase = await sequelize.transaction(async (transaction) => InventoryPurchase.create({
            order_number: createBatchCode("PO"),
            supplier_id: supplier.inventory_supplier_id,
            supplier_name: supplier.name,
            item_id: item.inventory_item_id,
            item_name: item.name,
            unit: item.unit,
            quantity,
            unit_price: unitPrice,
            invoice_reference: invoice,
            expiry_date: expiry,
            order_date: new Date().toISOString().slice(0, 10),
        }, { transaction }));
        return res.status(201).json({ success: true, purchase: serializePurchase(purchase) });
    } catch (error) {
        return next(error);
    }
};

export const receivePurchase = async (req, res, next) => {
    try {
        const id = validateId(req.params.id);
        const received = await sequelize.transaction(async (transaction) => {
            const purchase = await InventoryPurchase.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!purchase) throw notFound("Purchase order not found.");
            if (purchase.status === "Cancelled" || purchase.status === "Received") throw badRequest("This purchase order cannot receive any more stock.");
            const remaining = Number(purchase.quantity) - Number(purchase.received_quantity);
            const amount = req.body?.quantity === undefined ? remaining : number(req.body.quantity, "quantity", { allowZero: false });
            if (amount > remaining) throw badRequest(`Only ${remaining} ${purchase.unit} remains to be received.`);
            const item = await findItem(purchase.item_id, transaction, true);
            const code = purchase.status === "Ordered" && amount === remaining
                ? purchase.order_number
                : `${purchase.order_number}-${Number(purchase.received_quantity) + amount}`;
            await InventoryBatch.create({
                item_id: item.inventory_item_id,
                batch_code: code,
                quantity: amount,
                unit_cost: Number(purchase.unit_price),
                expiry_date: purchase.expiry_date,
                received_at: new Date(),
            }, { transaction });
            await item.update({
                quantity: Number(item.quantity) + amount,
                unit_cost: Number(purchase.unit_price),
            }, { transaction });
            await addMovement(item, {
                type: "Purchase received",
                quantity: amount,
                unitCost: Number(purchase.unit_price),
                reason: `Purchase ${purchase.order_number} · ${purchase.supplier_name}`,
                batch: code,
                expiry: purchase.expiry_date,
            }, transaction);
            const receivedQuantity = Number(purchase.received_quantity) + amount;
            await purchase.update({
                received_quantity: receivedQuantity,
                status: receivedQuantity >= Number(purchase.quantity) ? "Received" : "Partially received",
            }, { transaction });
            return purchase;
        });
        return res.json({ success: true, purchase: serializePurchase(received) });
    } catch (error) {
        return next(error);
    }
};

export const cancelPurchase = async (req, res, next) => {
    try {
        const id = validateId(req.params.id);
        await sequelize.transaction(async (transaction) => {
            const purchase = await InventoryPurchase.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!purchase) throw notFound("Purchase order not found.");
            if (purchase.status !== "Ordered" || Number(purchase.paid_amount) > 0) {
                throw badRequest("Only an unpaid order that has not been received can be cancelled.");
            }
            await purchase.update({ status: "Cancelled" }, { transaction });
        });
        return res.json({ success: true });
    } catch (error) {
        return next(error);
    }
};

export const recordPurchasePayment = async (req, res, next) => {
    try {
        const id = validateId(req.params.id);
        const amount = number(req.body?.amount, "amount", { min: 0, allowZero: false, decimals: 2 });
        const reference = text(req.body?.reference, "reference", 120, { optional: true });
        await sequelize.transaction(async (transaction) => {
            const purchase = await InventoryPurchase.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!purchase) throw notFound("Purchase order not found.");
            if (purchase.status === "Cancelled") throw badRequest("A cancelled purchase order cannot be paid.");
            const due = Number(purchase.quantity) * Number(purchase.unit_price) - Number(purchase.paid_amount);
            if (amount > due) throw badRequest(`Payment cannot exceed the outstanding amount of ${due}.`);
            await InventoryPayment.create({ purchase_id: id, amount, reference }, { transaction });
            await purchase.update({ paid_amount: Number(purchase.paid_amount) + amount }, { transaction });
        });
        return res.status(201).json({ success: true });
    } catch (error) {
        return next(error);
    }
};

export const createRecipe = async (req, res, next) => {
    try {
        const dish = text(req.body?.dish, "dish");
        const itemId = validateId(req.body?.itemId, "itemId");
        const quantity = number(req.body?.quantity, "quantity", { allowZero: false });
        const item = await InventoryItem.findByPk(itemId);
        if (!item) throw badRequest("Choose a valid inventory item.");
        const unit = req.body?.unit === undefined ? item.unit : text(req.body.unit, "unit", 24);
        const quantityInStockUnits = recipeQuantityInStockUnits(quantity, unit, item.unit);
        const recipe = await InventoryRecipe.create({ dish_name: dish, item_id: itemId, quantity_per_serving: quantityInStockUnits });
        return res.status(201).json({ success: true, recipeId: idOf(recipe, "inventory_recipe_id") });
    } catch (error) {
        return next(error);
    }
};

export const updateRecipe = async (req, res, next) => {
    try {
        const id = validateId(req.params.id);
        const dish = text(req.body?.dish, "dish");
        const itemId = validateId(req.body?.itemId, "itemId");
        const quantity = number(req.body?.quantity, "quantity", { allowZero: false });
        const item = await InventoryItem.findByPk(itemId);
        if (!item) throw badRequest("Choose a valid inventory item.");
        const unit = req.body?.unit === undefined ? item.unit : text(req.body.unit, "unit", 24);
        const quantityInStockUnits = recipeQuantityInStockUnits(quantity, unit, item.unit);
        const recipe = await InventoryRecipe.findByPk(id);
        if (!recipe) throw notFound("Recipe ingredient not found.");
        await recipe.update({ dish_name: dish, item_id: itemId, quantity_per_serving: quantityInStockUnits });
        return res.json({ success: true });
    } catch (error) {
        return next(error);
    }
};

export const deleteRecipe = async (req, res, next) => {
    try {
        const id = validateId(req.params.id);
        const recipe = await InventoryRecipe.findByPk(id);
        if (!recipe) throw notFound("Recipe ingredient not found.");
        await recipe.destroy();
        return res.json({ success: true });
    } catch (error) {
        return next(error);
    }
};

export const completePosSale = async (req, res, next) => {
    try {
        const dish = text(req.body?.dish, "dish");
        const portions = number(req.body?.portions, "portions", { allowZero: false, decimals: 0 });
        const recipeRows = await InventoryRecipe.findAll({ where: { dish_name: dish }, order: [["inventory_recipe_id", "ASC"]] });
        if (!recipeRows.length) throw badRequest(`No recipe ingredients are configured for ${dish}.`);
        await sequelize.transaction(async (transaction) => {
            const requirements = new Map();
            for (const recipe of recipeRows) {
                const itemId = String(recipe.item_id);
                requirements.set(itemId, (requirements.get(itemId) || 0) + Number(recipe.quantity_per_serving) * portions);
            }
            const lockedItems = new Map();
            for (const [itemId, amount] of [...requirements].sort(([left], [right]) => Number(left) - Number(right))) {
                const item = await findItem(itemId, transaction, true);
                if (Number(item.quantity) < amount) {
                    throw badRequest(`Not enough ${item.name} for ${portions} ${dish} serving${portions === 1 ? "" : "s"}. Sale was not recorded.`);
                }
                lockedItems.set(itemId, { item, amount });
            }
            for (const { item, amount } of lockedItems.values()) {
                const consumedCost = await consumeStock(item, amount, transaction);
                await item.update({ quantity: Number(item.quantity) - amount }, { transaction });
                await addMovement(item, {
                    type: "POS consumption",
                    quantity: amount,
                    unitCost: consumedCost / amount,
                    totalCost: consumedCost,
                    reason: `Completed POS bill · ${portions} × ${dish}`,
                    batch: "FIFO allocation",
                }, transaction);
            }
        });
        return res.status(201).json({ success: true, message: `Recipe stock deducted for ${portions} × ${dish}.` });
    } catch (error) {
        return next(error);
    }
};

export const getInventoryReport = async (req, res, next) => {
    try {
        const days = Number(req.query.days ?? 30);
        if (![7, 30, 90].includes(days)) throw badRequest("days must be 7, 30, or 90.");
        const since = new Date();
        since.setDate(since.getDate() - days);
        const [items, batches, movements, purchases] = await Promise.all([
            InventoryItem.findAll(),
            InventoryBatch.findAll({ where: { quantity: { [Op.gt]: 0 } } }),
            InventoryMovement.findAll({ where: { createdAt: { [Op.gte]: since } }, order: [["createdAt", "DESC"]] }),
            InventoryPurchase.findAll({
                where: {
                    order_date: { [Op.gte]: since.toISOString().slice(0, 10) },
                    status: { [Op.ne]: "Cancelled" },
                },
            }),
        ]);
        const currentStockValue = batches.reduce((sum, batch) => sum + Number(batch.quantity) * Number(batch.unit_cost), 0);
        const purchaseSpend = purchases.reduce((sum, purchase) => sum + Number(purchase.received_quantity) * Number(purchase.unit_price), 0);
        const consumptionValue = movements
            .filter((movement) => [
                "Kitchen consumption", "Wastage", "Damage", "Supplier return", "Expired", "POS consumption", "Recipe production", "Production reversal",
            ].includes(movement.movement_type))
            .reduce((sum, movement) => {
                const item = items.find((entry) => String(entry.inventory_item_id) === String(movement.item_id));
                const direction = movement.movement_type === "Production reversal" ? -1 : 1;
                const movementCost = movement.total_cost_snapshot === null || movement.total_cost_snapshot === undefined
                    ? Number(movement.quantity) * Number(item?.unit_cost || 0)
                    : Number(movement.total_cost_snapshot);
                return sum + direction * movementCost;
            }, 0);
        return res.json({
            success: true,
            report: {
                days,
                currentStockValue,
                purchaseSpend,
                consumptionValue,
                receiptCount: movements.filter((movement) => movement.movement_type === "Purchase received").length,
            },
        });
    } catch (error) {
        return next(error);
    }
};
