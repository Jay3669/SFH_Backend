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

function kolkataHour(now) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now);
    return Number(parts.find(({ type }) => type === "hour")?.value);
}

export function getBillingPeriodRange(period, now = new Date()) {
    if (!["daily", "weekly", "monthly"].includes(period)) {
        throw Object.assign(new Error("period must be daily, weekly, or monthly."), { status: 400 });
    }

    const businessDate = kolkataDate(now);
    if (kolkataHour(now) < 6) businessDate.setUTCDate(businessDate.getUTCDate() - 1);
    const start = new Date(businessDate);
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
    const startAt = new Date(start.getTime() + 6 * 60 * 60 * 1000 - indiaOffset);
    const endAt = new Date(end.getTime() + 2 * 60 * 60 * 1000 - indiaOffset);
    return {
        from: dateString(start),
        to: dateString(new Date(end.getTime() - 86400000)),
        endExclusive: dateString(end),
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
    };
}

function roundCurrency(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function summarizeBillingReport(purchases, sales) {
    const purchaseTotal = roundCurrency(purchases.reduce((sum, purchase) => sum + Number(purchase.total), 0));
    const activeSales = sales.filter((sale) => !/^(voided|void|cancelled)$/i.test(sale.status || ""));
    const salesTotal = roundCurrency(activeSales.reduce((sum, sale) => sum + Number(sale.total), 0));
    return {
        purchases: { count: purchases.length, total: purchaseTotal, bills: purchases },
        sales: { count: activeSales.length, total: salesTotal, bills: sales },
        grandTotal: roundCurrency(purchaseTotal + salesTotal),
    };
}
