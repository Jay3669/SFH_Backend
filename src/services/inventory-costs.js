export function unitCostFromTotal(totalCost, quantity) {
    const total = Number(totalCost);
    const amount = Number(quantity);
    if (!Number.isFinite(total) || total < 0 || !Number.isFinite(amount) || amount < 0) {
        throw new RangeError("Total cost and quantity must be finite and non-negative.");
    }
    return amount === 0 ? 0 : total / amount;
}

export function weightedUnitCost(batches, fallback = 0) {
    let quantity = 0;
    let totalCost = 0;
    for (const batch of batches) {
        const batchQuantity = Number(batch.quantity);
        const batchUnitCost = Number(batch.unit_cost);
        if (batchQuantity > 0 && Number.isFinite(batchQuantity) && Number.isFinite(batchUnitCost)) {
            quantity += batchQuantity;
            totalCost += batchQuantity * batchUnitCost;
        }
    }
    return quantity > 0 ? totalCost / quantity : Number(fallback || 0);
}