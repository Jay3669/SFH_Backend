import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import test from "node:test";
import {
    discountApprovalRequired,
    matchDiscountApprover,
    nextPinAttemptState,
    normalizeCompItemIds,
    validateDiscountAuthorization,
} from "./discount-authorizations.js";

test("requires approval only above ten percent or for a comp", () => {
    assert.equal(discountApprovalRequired({ subtotal: 100, discountAmount: 10, compItemIds: [] }), false);
    assert.equal(discountApprovalRequired({ subtotal: 100, discountAmount: 10.01, compItemIds: [] }), true);
    assert.equal(discountApprovalRequired({ subtotal: 100, discountAmount: 0, compItemIds: ["1"] }), true);
});

test("validates comp lines and required approval reason and PIN", () => {
    assert.deepEqual(normalizeCompItemIds(["1", 1], new Set(["1"])), ["1"]);
    assert.throws(() => normalizeCompItemIds(["2"], new Set(["1"])), { status: 400 });
    assert.throws(() => validateDiscountAuthorization({ required: true }), { status: 403 });
    assert.throws(() => validateDiscountAuthorization({
        required: true,
        authorization: { pin: "123", reasonCode: "promotion" },
    }), { status: 400 });
    assert.throws(() => validateDiscountAuthorization({
        required: true,
        authorization: { pin: "1234", reasonCode: "unknown" },
    }), { status: 400 });
    assert.deepEqual(validateDiscountAuthorization({
        required: true,
        authorization: { pin: "1234", reasonCode: "promotion" },
    }), { pin: "1234", reasonCode: "promotion" });
});

test("only active Admin and Manager accounts can approve with a PIN", async () => {
    const hash = await bcrypt.hash("2468", 4);
    const approvers = [
        { id: 1, role: "Employee", status: "active", manager_pin_hash: hash },
        { id: 2, role: "Manager", status: "inactive", manager_pin_hash: hash },
        { id: 3, role: "Manager", status: "active", manager_pin_hash: hash },
    ];
    assert.equal((await matchDiscountApprover("2468", approvers)).id, 3);
    assert.equal(await matchDiscountApprover("0000", approvers), null);
});

test("locks PIN attempts after five failures and resets attempts outside the window", () => {
    const now = Date.now();
    const state = { failed_attempts: 4, window_started_at: new Date(now - 1000) };
    const locked = nextPinAttemptState(state, now);
    assert.equal(locked.failedAttempts, 5);
    assert.equal(locked.lockedUntil.getTime(), now + 15 * 60 * 1000);
    const reset = nextPinAttemptState({ failed_attempts: 4, window_started_at: new Date(now - 16 * 60 * 1000) }, now);
    assert.equal(reset.failedAttempts, 1);
});
