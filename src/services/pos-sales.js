const paymentMethods = new Set(["Cash", "Card", "UPI"]);

function badRequest(message) {
    return Object.assign(new Error(message), { status: 400 });
}

function roundCurrency(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundTaxToRupee(value) {
    return Math.floor(Number(value) + 0.5);
}

function money(value, field) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999.99 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
        throw badRequest(`${field} must be a non-negative amount with at most two decimal places.`);
    }
    return amount;
}

export function calculatePosTotals({ subtotal: subtotalValue, discountAmount: discountValue, orderType = "Dine-in", packagingAmount: packagingValue = 0, paymentMethod, tenders: payloadTenders, settings }) {
    const subtotal = money(subtotalValue, "subtotal");
    const discountAmount = money(discountValue, "discountAmount");
    if (discountAmount > subtotal) throw badRequest("discountAmount cannot exceed the subtotal.");
    if (!["Dine-in", "Takeaway"].includes(orderType)) throw badRequest("orderType must be Dine-in or Takeaway.");
    const requestedPackagingAmount = money(packagingValue, "packagingAmount");
    const packagingAmount = settings.packagingEnabled && orderType === "Takeaway" ? requestedPackagingAmount : 0;
    const taxableAmount = Math.max(0, subtotal - discountAmount) + packagingAmount;
    const taxRate = settings.taxEnabled ? Number(settings.taxRate) : 0;
    const taxAmount = settings.taxEnabled ? roundTaxToRupee(taxableAmount * taxRate / 100) : 0;
    const total = roundCurrency(Math.max(0, subtotal - discountAmount + packagingAmount + taxAmount));

    if (![...paymentMethods, "Split"].includes(paymentMethod)) throw badRequest("paymentMethod must be Cash, Card, UPI, or Split.");
    if (paymentMethod === "Split" && !settings.paymentMethods.split) throw badRequest("Split tender is disabled in POS settings.");
    if (paymentMethod !== "Split" && !settings.paymentMethods[paymentMethod.toLowerCase()]) {
        throw badRequest(`${paymentMethod} payments are disabled in POS settings.`);
    }
    if (!Array.isArray(payloadTenders) || payloadTenders.length > 100) throw badRequest("tenders must be an array with no more than 100 lines.");
    const tenders = payloadTenders.map((row) => {
        const method = row?.method;
        if (!paymentMethods.has(method) || !settings.paymentMethods[method.toLowerCase()]) {
            throw badRequest("Every tender must use an enabled Cash, Card, or UPI method.");
        }
        const transactionRef = row.transactionRef ?? row.transaction_ref ?? "";
        if (typeof transactionRef !== "string" || transactionRef.trim().length > 120) {
            throw badRequest("transactionRef must be at most 120 characters.");
        }
        return { method, amount: money(row.amount, "tender amount"), transactionRef: transactionRef.trim() || null };
    }).filter((row) => row.amount > 0);
    if (paymentMethod !== "Split" && (tenders.length > 1 || (tenders.length === 1 && tenders[0].method !== paymentMethod))) {
        throw badRequest("A non-split bill must have one tender matching its payment method.");
    }
    if (paymentMethod === "Split" && tenders.length < 2) throw badRequest("Split tender requires at least two payment lines.");

    const amountTendered = roundCurrency(tenders.reduce((sum, row) => sum + row.amount, 0));
    const amountPaid = Math.min(total, amountTendered);
    const nonCashTendered = tenders.filter((row) => row.method !== "Cash").reduce((sum, row) => sum + row.amount, 0);
    const cashTendered = tenders.filter((row) => row.method === "Cash").reduce((sum, row) => sum + row.amount, 0);
    const changeDue = roundCurrency(Math.max(0, cashTendered - Math.max(0, total - nonCashTendered)));
    if (amountTendered > total && changeDue < amountTendered - total - 0.000001) {
        throw badRequest("Overpayment must be covered by cash so change can be returned.");
    }
    return {
        subtotal,
        discountAmount,
        orderType,
        packagingAmount,
        taxRate,
        taxAmount,
        total,
        paymentMethod,
        tenders,
        amountTendered,
        amountPaid,
        changeDue,
        balanceDue: roundCurrency(total - amountPaid),
    };
}