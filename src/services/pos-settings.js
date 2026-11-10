export const DEFAULT_POS_SETTINGS = {
    billNumberPrefix: "POS-",
    nextBillNumber: 1,
    packagingEnabled: false,
    packagingAmount: 0,
    taxEnabled: false,
    taxRate: 0,
    paymentMethods: {
        cash: true,
        card: true,
        upi: true,
        split: false,
    },
    allowBalanceDue: false,
    dateFormat: "DD/MM/YYYY",
    timeFormat: "12-hour",
};

const DATE_FORMATS = new Set([
    "DD/MM/YYYY",
    "MM/DD/YYYY",
    "YYYY-MM-DD",
    "DD-MM-YYYY",
    "MM-DD-YYYY",
    "DD MMM YYYY",
    "MMMM DD, YYYY",
]);
const TIME_FORMATS = new Set(["12-hour", "24-hour"]);

function badRequest(message) {
    return Object.assign(new Error(message), { status: 400 });
}

function formatValue(value, allowedValues, field) {
    if (!allowedValues.has(value)) {
        throw badRequest(`${field} must be one of: ${[...allowedValues].join(", ")}.`);
    }
    return value;
}

function booleanValue(value, field) {
    if (typeof value !== "boolean") throw badRequest(`${field} must be a boolean.`);
    return value;
}

function amountValue(value, field, max = 99999999.99) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > max || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
        throw badRequest(`${field} must be a non-negative amount with at most two decimal places.`);
    }
    return amount;
}

function billNumberPrefixValue(value) {
    if (typeof value !== "string" || value.trim().length > 32 || !/^[A-Za-z0-9._/-]*$/.test(value.trim())) {
        throw badRequest("billNumberPrefix must contain at most 32 letters, numbers, or . _ / - characters.");
    }
    return value.trim();
}

function nextBillNumberValue(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number >= Number.MAX_SAFE_INTEGER) {
        throw badRequest("nextBillNumber must be a positive whole number.");
    }
    return number;
}

export function normalizePosSettings(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw badRequest("Settings must be an object.");
    }
    const paymentMethods = payload.paymentMethods;
    if (!paymentMethods || typeof paymentMethods !== "object" || Array.isArray(paymentMethods)) {
        throw badRequest("paymentMethods must be an object.");
    }
    const settings = {
        billNumberPrefix: payload.billNumberPrefix === undefined
            ? DEFAULT_POS_SETTINGS.billNumberPrefix
            : billNumberPrefixValue(payload.billNumberPrefix),
        nextBillNumber: payload.nextBillNumber === undefined
            ? DEFAULT_POS_SETTINGS.nextBillNumber
            : nextBillNumberValue(payload.nextBillNumber),
        packagingEnabled: booleanValue(payload.packagingEnabled, "packagingEnabled"),
        packagingAmount: amountValue(payload.packagingAmount, "packagingAmount"),
        taxEnabled: booleanValue(payload.taxEnabled, "taxEnabled"),
        taxRate: amountValue(payload.taxRate, "taxRate", 100),
        paymentMethods: {
            cash: booleanValue(paymentMethods.cash, "paymentMethods.cash"),
            card: booleanValue(paymentMethods.card, "paymentMethods.card"),
            upi: booleanValue(paymentMethods.upi, "paymentMethods.upi"),
            split: booleanValue(paymentMethods.split, "paymentMethods.split"),
        },
        allowBalanceDue: booleanValue(payload.allowBalanceDue, "allowBalanceDue"),
        dateFormat: formatValue(payload.dateFormat ?? DEFAULT_POS_SETTINGS.dateFormat, DATE_FORMATS, "dateFormat"),
        timeFormat: formatValue(payload.timeFormat ?? DEFAULT_POS_SETTINGS.timeFormat, TIME_FORMATS, "timeFormat"),
    };
    if (!settings.paymentMethods.cash && !settings.paymentMethods.card && !settings.paymentMethods.upi) {
        throw badRequest("Enable at least one payment method: cash, card, or UPI.");
    }
    return settings;
}