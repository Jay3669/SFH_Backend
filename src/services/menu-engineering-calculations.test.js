import test from "node:test";
import assert from "node:assert/strict";
import { calculateMenuEngineering } from "./menu-engineering-calculations.js";

function dish(dishName, soldQuantity, grossProfitPerServing, ingredientCostPerServing = 10) {
    return {
        dishName,
        soldQuantity,
        ingredientCostPerServing,
        grossProfitPerServing,
        totalGrossProfit: Number.isFinite(grossProfitPerServing) ? soldQuantity * grossProfitPerServing : null,
    };
}

test("classifies dishes by relative popularity and average gross profit", () => {
    const result = calculateMenuEngineering([
        dish("Star", 70, 30),
        dish("Plowhorse", 20, 10),
        dish("Puzzle", 5, 40),
        dish("Dog", 5, 5),
    ]);

    assert.deepEqual(Object.fromEntries(result.dishes.map((row) => [row.dishName, row.category])), {
        Star: "Star",
        Plowhorse: "Plowhorse",
        Puzzle: "Puzzle",
        Dog: "Dog",
    });
    assert.equal(result.thresholds.popularityThresholdPercent, 17.5);
    assert.equal(result.thresholds.profitThresholdPerServing, 21.25);
});

test("keeps missing recipe costs unclassified and out of profit threshold", () => {
    const result = calculateMenuEngineering([
        dish("Costed popular", 80, 20),
        dish("Costed less popular", 10, 10),
        dish("No recipe", 10, null, null),
    ]);
    const missing = result.dishes.find((row) => row.dishName === "No recipe");

    assert.equal(missing.category, "Needs costing");
    assert.equal(missing.grossProfitPerServing, null);
    assert.equal(result.thresholds.profitThresholdPerServing, 15);
    assert.equal(result.summary.missingCostDishCount, 1);
});

test("returns stable empty thresholds when there are no dishes", () => {
    const result = calculateMenuEngineering([]);
    assert.deepEqual(result.dishes, []);
    assert.equal(result.thresholds.profitThresholdPerServing, null);
    assert.equal(result.summary.totalSoldQuantity, 0);
});
