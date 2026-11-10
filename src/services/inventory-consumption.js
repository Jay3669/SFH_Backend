import { Op } from "sequelize";
import { sequelize } from "../config/db.js";
import InventoryBatch from "../models/inventory-batch.model.js";
import InventoryDeductionJob from "../models/inventory-deduction-job.model.js";
import InventoryItem from "../models/inventory-item.model.js";
import InventoryMovement from "../models/inventory-movement.model.js";
import InventoryRecipe from "../models/inventory-recipe.model.js";
import PosSale from "../models/pos-sale.model.js";
import { buildRecipeRequirements } from "./recipe-consumption.js";
import { logger } from "../utils/logger.js";

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

function roundCurrency(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export async function enqueuePosSaleInventoryDeduction(menuLines, sale, transaction) {
    const dishNames = [...new Set(menuLines.map((line) => line.menuItem.name))];
    const recipes = await InventoryRecipe.findAll({
        where: { dish_name: dishNames },
        transaction,
    });
    const { requirements, warnings } = buildRecipeRequirements(menuLines, recipes);

    await InventoryDeductionJob.create({
        sale_id: sale.pos_sale_id,
        requirements,
        warnings,
        status: "pending",
        available_at: new Date(),
    }, { transaction });
    await sale.update({
        stock_deducted: false,
        stock_deduction_status: "pending",
        stock_warnings: warnings,
    }, { transaction });
}

async function applyDeductionJob(jobId) {
    return sequelize.transaction(async (transaction) => {
        const job = await InventoryDeductionJob.findByPk(jobId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!job || job.status !== "pending") return false;

        const sale = await PosSale.findByPk(job.sale_id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!sale) throw httpError(`POS sale ${job.sale_id} was not found.`, 404);
        if (sale.status !== "Paid") throw httpError("Inventory can only be deducted for fully paid POS sales.", 409);

        const lockedItems = [];
        for (const requirement of [...job.requirements].sort((a, b) => Number(a.itemId) - Number(b.itemId))) {
            const item = await InventoryItem.findByPk(requirement.itemId, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            const amount = Number(requirement.quantity);
            if (!item || Number(item.quantity) + 0.000001 < amount) {
                throw httpError(`Not enough ${item?.name || "inventory"} for POS bill ${sale.bill_number}.`);
            }
            const batches = await InventoryBatch.findAll({
                where: { item_id: item.inventory_item_id, quantity: { [Op.gt]: 0 } },
                order: [["received_at", "ASC"], ["expiry_date", "ASC"], ["inventory_batch_id", "ASC"]],
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            const batchQuantity = batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
            if (batchQuantity + 0.000001 < amount) {
                throw httpError(`Not enough batch stock for ${item.name} on POS bill ${sale.bill_number}.`);
            }
            lockedItems.push({ item, amount, batches });
        }

        const warnings = [...job.warnings];
        for (const { item, amount, batches } of lockedItems) {
            let remaining = amount;
            let totalCost = 0;
            for (const batch of batches) {
                if (remaining <= 0.000001) break;
                const used = Math.min(Number(batch.quantity), remaining);
                await batch.update({ quantity: Number(batch.quantity) - used }, { transaction });
                totalCost += used * Number(batch.unit_cost);
                remaining -= used;
            }
            const remainingStock = Number(item.quantity) - amount;
            const roundedCost = roundCurrency(totalCost);
            await item.update({ quantity: remainingStock }, { transaction });
            await InventoryMovement.create({
                item_id: item.inventory_item_id,
                movement_type: "POS consumption",
                quantity: amount,
                unit_cost_snapshot: roundedCost / amount,
                total_cost_snapshot: roundedCost,
                reason: `POS bill ${sale.bill_number}`,
                batch_code: "FIFO allocation",
            }, { transaction });
            if (remainingStock <= Number(item.reorder_level)) {
                warnings.push(`${item.name} is at or below its reorder level (${Number(item.reorder_level)} ${item.unit}).`);
            }
        }

        await sale.update({
            stock_deducted: lockedItems.length > 0,
            stock_deduction_status: "completed",
            stock_warnings: warnings,
        }, { transaction });
        await job.update({
            status: "completed",
            last_error: null,
            processed_at: new Date(),
        }, { transaction });
        return true;
    });
}

async function recordDeductionFailure(jobId, error) {
    await sequelize.transaction(async (transaction) => {
        const job = await InventoryDeductionJob.findByPk(jobId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!job || job.status !== "pending") return;
        const message = error.message || "Inventory deduction failed.";
        const retryDelayMs = Math.min(15 * 60_000, 30_000 * (2 ** Math.min(Number(job.attempts), 5)));
        await job.update({
            attempts: Number(job.attempts) + 1,
            available_at: new Date(Date.now() + retryDelayMs),
            last_error: message,
        }, { transaction });
        const sale = await PosSale.findByPk(job.sale_id, { transaction });
        if (sale) {
            await sale.update({
                stock_deduction_status: "pending",
                stock_warnings: [...job.warnings, `Inventory deduction is waiting to retry: ${message}`],
            }, { transaction });
        }
    });
    logger.error("POS recipe stock deduction failed; queued for retry", {
        jobId: String(jobId),
        message: error.message,
    });
}

export async function processNextInventoryDeduction() {
    const job = await InventoryDeductionJob.findOne({
        where: { status: "pending", available_at: { [Op.lte]: new Date() } },
        order: [["inventory_deduction_job_id", "ASC"]],
        attributes: ["inventory_deduction_job_id"],
    });
    if (!job) return false;

    try {
        return await applyDeductionJob(job.inventory_deduction_job_id);
    } catch (error) {
        await recordDeductionFailure(job.inventory_deduction_job_id, error);
        return false;
    }
}

export function startInventoryConsumptionWorker({ intervalMs = 1000 } = {}) {
    let running = false;
    const timer = setInterval(async () => {
        if (running) return;
        running = true;
        try {
            await processNextInventoryDeduction();
        } catch (error) {
            logger.error("Inventory consumption worker failed", { message: error.message, stack: error.stack });
        } finally {
            running = false;
        }
    }, intervalMs);
    timer.unref();
    return timer;
}
