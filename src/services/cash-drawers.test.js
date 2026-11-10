import assert from "node:assert/strict";
import test from "node:test";
import { calculateCashCollected, calculateExpectedCash } from "./cash-drawers.js";

test("computes expected cash from float, cash sales, and audited movements", () => {
    assert.equal(calculateExpectedCash(200, 125.5, [
        { direction: "in", amount: 20 },
        { direction: "out", amount: 35.25 },
    ]), 310.25);
});

test("counts only cash tenders and removes change returned", () => {
    const sales = [
        { pos_sale_id: 1, change_due: 20 },
        { pos_sale_id: 2, change_due: 0 },
        { pos_sale_id: 3, payment_method: "Cash", amount_paid: 30, change_due: 0 },
    ];
    const payments = new Map([
        ["1", [{ method: "Cash", amount: 120 }, { method: "UPI", amount: 20 }]],
        ["2", [{ method: "UPI", amount: 50 }]],
    ]);
    assert.equal(calculateCashCollected(sales, payments), 130);
});
