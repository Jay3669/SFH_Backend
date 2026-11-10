import test from "node:test";
import assert from "node:assert/strict";
import {
    canAdvanceKotStatus,
    deriveKotStatus,
    formatKotNumber,
    groupKotLinesByStation,
    normalizeKotLines,
} from "./kot-orders.js";

test("normalizes KOT line identifiers, quantities, and notes", () => {
    assert.deepEqual(normalizeKotLines([
        { menuItemId: "12", quantity: 2, notes: "  No onion  " },
    ]), [{ menuItemId: "12", quantity: 2, notes: "No onion" }]);
});

test("rejects malformed KOT lines", () => {
    assert.throws(() => normalizeKotLines([{ menuItemId: "0", quantity: 1 }]), /positive integer/);
    assert.throws(() => normalizeKotLines([{ menuItemId: "1", quantity: 0 }]), /positive whole number/);
    assert.throws(() => normalizeKotLines([{ menuItemId: "1", quantity: 100 }]), /between 1 and 99/);
    assert.throws(() => normalizeKotLines([]), /between 1 and 100/);
});

test("derives ticket status from item progress", () => {
    assert.equal(deriveKotStatus([{ status: "pending" }, { status: "pending" }]), "pending");
    assert.equal(deriveKotStatus([{ status: "cooking" }, { status: "pending" }]), "cooking");
    assert.equal(deriveKotStatus([{ status: "ready" }, { status: "served" }]), "ready");
    assert.equal(deriveKotStatus([{ status: "served" }, { status: "served" }]), "served");
});

test("only allows forward KOT status transitions", () => {
    assert.equal(canAdvanceKotStatus("pending", "cooking"), true);
    assert.equal(canAdvanceKotStatus("pending", "ready"), false);
    assert.equal(canAdvanceKotStatus("served", "pending"), false);
    assert.equal(canAdvanceKotStatus("ready", "ready"), true);
});

test("formats a sequential ticket number for display", () => {
    assert.equal(formatKotNumber("42"), "KOT-000042");
});

test("groups order lines into separate KOTs in station order", () => {
    const groups = groupKotLinesByStation([
        { menuItem: { name: "Lassi", kitchen_station: "Beverages" } },
        { menuItem: { name: "Paneer Tikka", kitchen_station: "Tandoor" } },
        { menuItem: { name: "Soup", kitchen_station: "Starters" } },
    ]);
    assert.deepEqual(groups.map(({ station }) => station), ["Tandoor", "Starters", "Beverages"]);
    assert.throws(() => groupKotLinesByStation([
        { menuItem: { name: "Dish", kitchen_station: "Unknown" } },
    ]), /invalid kitchen station/);
});
