export const TABLE_STATUSES = ["vacant", "occupied", "billed", "dirty/cleaning"];

const STATUS_TRANSITIONS = {
    occupied: ["billed"],
    billed: ["dirty/cleaning"],
    "dirty/cleaning": ["vacant"],
};

function httpError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

export function normalizeTableName(value, field = "tableName") {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 64) {
        throw httpError(`${field} is required and must be at most 64 characters.`);
    }
    return value.trim();
}

export function assertTableTransferAllowed(action, sourceStatus, destinationStatus) {
    if (sourceStatus !== "occupied") throw httpError("Only an occupied table can be moved or merged.", 409);
    if (action === "move" && destinationStatus !== "vacant") {
        throw httpError("The destination table must be vacant to move an order.", 409);
    }
    if (action === "merge" && destinationStatus !== "occupied") {
        throw httpError("The destination table must be occupied to merge orders.", 409);
    }
}

export function assertTableStatusTransition(currentStatus, nextStatus) {
    if (!TABLE_STATUSES.includes(nextStatus)) {
        throw httpError(`status must be one of: ${TABLE_STATUSES.join(", ")}.`);
    }
    if (!STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus)) {
        throw httpError(`A ${currentStatus} table cannot be changed to ${nextStatus}.`, 409);
    }
}
