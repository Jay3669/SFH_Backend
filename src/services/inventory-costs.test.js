import assert from "node:assert/strict";
import test from "node:test";
import { unitCostFromTotal, weightedUnitCost } from "./inventory-costs.js";

test("derives unit cost from opening stock total value", () => {
    assert.equal(unitCostFromTotal(9000, 10), 900);
    assert.equal(0.5 * unitCostFromTotal(9000, 10), 450);
    assert.equal(unitCostFromTotal(9000, 0), 0);
});

test("values remaining stock using weighted batch costs", () => {
    assert.equal(weightedUnitCost([
        { quantity: 2, unit_cost: 900 },
        { quantity: 8, unit_cost: 1000 },
    ]), 980);
    assert.equal(weightedUnitCost([], 900), 900);
});