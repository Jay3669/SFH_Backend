import bcrypt from "bcrypt";

export const DISCOUNT_REASON_CODES = Object.freeze({
    service_recovery: "Service recovery",
    promotion: "Promotion",
    pricing_error: "Pricing correction",
    customer_retention: "Customer retention",
    other: "Other",
});

export const DISCOUNT_PIN_MAX_ATTEMPTS = 5;
export const DISCOUNT_PIN_WINDOW_MS = 15 * 60 * 1000;
export const DISCOUNT_PIN_LOCK_MS = 15 * 60 * 1000;

export function normalizeCompItemIds(value, lineIds) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 100) {
        throw Object.assign(new Error("compItemIds must be an array with no more than 100 items."), { status: 400 });
    }
    const ids = [...new Set(value.map((itemId) => {
        if (!/^[1-9]\d*$/.test(String(itemId))) {
            throw Object.assign(new Error("Each compItemId must be a positive integer."), { status: 400 });
        }
        return String(itemId);
    }))];
    if (ids.some((itemId) => !lineIds.has(itemId))) {
        throw Object.assign(new Error("Every comp item must be present in the bill."), { status: 400 });
    }
    return ids;
}

export function discountApprovalRequired({ subtotal, discountAmount, compItemIds }) {
    return compItemIds.length > 0 || discountAmount > subtotal * 0.1 + 0.000001;
}

export function validateDiscountAuthorization({ authorization, required }) {
    if (!required) return null;
    if (!authorization || typeof authorization !== "object") {
        throw Object.assign(new Error("Manager approval is required for discounts above 10% or comp items."), { status: 403 });
    }
    const pin = authorization.pin;
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
        throw Object.assign(new Error("Manager approval PIN must contain exactly four digits."), { status: 400 });
    }
    const reasonCode = authorization.reasonCode;
    if (typeof reasonCode !== "string" || !Object.hasOwn(DISCOUNT_REASON_CODES, reasonCode)) {
        throw Object.assign(new Error("A valid discount reason code is required."), { status: 400 });
    }
    return { pin, reasonCode };
}

export async function matchDiscountApprover(pin, users) {
    for (const user of users) {
        if (
            !["Admin", "Manager"].includes(user.role)
            || user.status !== "active"
            || !user.manager_pin_hash
        ) continue;
        if (await bcrypt.compare(pin, user.manager_pin_hash)) return user;
    }
    return null;
}

export function nextPinAttemptState(attempt, now = Date.now()) {
    const windowStartedAt = attempt?.window_started_at ? new Date(attempt.window_started_at).getTime() : 0;
    const lockedUntil = attempt?.locked_until ? new Date(attempt.locked_until).getTime() : 0;
    if (lockedUntil > now) {
        return { lockedUntil: new Date(lockedUntil), failedAttempts: attempt.failed_attempts || 0, windowStartedAt: new Date(windowStartedAt) };
    }
    const inWindow = windowStartedAt > 0 && now - windowStartedAt < DISCOUNT_PIN_WINDOW_MS;
    const failedAttempts = (inWindow ? Number(attempt?.failed_attempts) || 0 : 0) + 1;
    return {
        failedAttempts,
        windowStartedAt: new Date(inWindow ? windowStartedAt : now),
        lockedUntil: failedAttempts >= DISCOUNT_PIN_MAX_ATTEMPTS
            ? new Date(now + DISCOUNT_PIN_LOCK_MS)
            : null,
    };
}
