export function summarizeKitchenTimings(items, slowThresholdMinutes = 25) {
    const grouped = new Map();
    for (const item of items) {
        const startedAt = item.order?.createdAt || item.createdAt;
        const durationMinutes = Math.max(0, (new Date(item.served_at) - new Date(startedAt)) / 60000);
        const row = grouped.get(item.item_name) || {
            name: item.item_name,
            samples: 0,
            quantity: 0,
            totalMinutes: 0,
            slowOrders: 0,
        };
        row.samples += 1;
        row.quantity += Number(item.quantity);
        row.totalMinutes += durationMinutes;
        if (durationMinutes > slowThresholdMinutes) row.slowOrders += 1;
        grouped.set(item.item_name, row);
    }

    return [...grouped.values()].map(({ totalMinutes, ...row }) => ({
        ...row,
        averageMinutes: row.samples ? Math.round(totalMinutes / row.samples * 10) / 10 : 0,
    })).sort((left, right) => right.averageMinutes - left.averageMinutes);
}
