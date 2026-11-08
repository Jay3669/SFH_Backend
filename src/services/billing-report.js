function dateString(date) {
    return date.toISOString().slice(0, 10);
}

function kolkataDate(now) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

export function getBillingPeriodRange(period, now = new Date()) {
    if (!["daily", "weekly", "monthly"].includes(period)) {
        throw Object.assign(new Error("period must be daily, weekly, or monthly."), { status: 400 });
    }

    const start = kolkataDate(now);
    if (period === "weekly") {
        const daysSinceMonday = (start.getUTCDay() + 6) % 7;
        start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    } else if (period === "monthly") {
        start.setUTCDate(1);
    }

    const end = new Date(start);
    if (period === "daily") end.setUTCDate(end.getUTCDate() + 1);
    if (period === "weekly") end.setUTCDate(end.getUTCDate() + 7);
    if (period === "monthly") end.setUTCMonth(end.getUTCMonth() + 1);

    const indiaOffset = 330 * 60 * 1000;
    return {
        from: dateString(start),
        to: dateString(new Date(end.getTime() - 86400000)),
        endExclusive: dateString(end),
        startAt: new Date(start.getTime() - indiaOffset).toISOString(),
        endAt: new Date(end.getTime() - indiaOffset).toISOString(),
    };
}

function roundCurrency(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function summarizeBillingReport(purchases, sales) {
    const purchaseTotal = roundCurrency(purchases.reduce((sum, purchase) => sum + Number(purchase.total), 0));
    const salesTotal = roundCurrency(sales.reduce((sum, sale) => sum + Number(sale.total), 0));
    return {
        purchases: { count: purchases.length, total: purchaseTotal, bills: purchases },
        sales: { count: sales.length, total: salesTotal, bills: sales },
        grandTotal: roundCurrency(purchaseTotal + salesTotal),
    };
}
