import assert from "node:assert/strict";
import test from "node:test";
import { buildRecipeRequirements } from "./recipe-consumption.js";

test("builds aggregated raw-material requirements for each sold serving", () => {
    const recipes = [
        { dish_name: "Chicken Biryani", item_id: 3, quantity_per_serving: "0.150" },
        { dish_name: "Chicken Biryani", item_id: 8, quantity_per_serving: "0.200" },
        { dish_name: "Curry", item_id: 3, quantity_per_serving: "0.075" },
    ];
    const result = buildRecipeRequirements([
        { menuItem: { name: "Chicken Biryani" }, quantity: 2 },
        { menuItem: { name: "Curry" }, quantity: 1 },
    ], recipes);

    assert.deepEqual(result, {
        requirements: [
            { itemId: "3", quantity: 0.375 },
            { itemId: "8", quantity: 0.4 },
        ],
        warnings: [],
    });
});

test("reports missing recipes without suppressing configured ingredient requirements", () => {
    const result = buildRecipeRequirements([
        { menuItem: { name: "Biryani" }, quantity: 1 },
        { menuItem: { name: "Lassi" }, quantity: 2 },
    ], [{ dish_name: "Biryani", item_id: 5, quantity_per_serving: "0.125" }]);

    assert.deepEqual(result.requirements, [{ itemId: "5", quantity: 0.125 }]);
    assert.deepEqual(result.warnings, ["Lassi has no recipe ingredients configured."]);
});
