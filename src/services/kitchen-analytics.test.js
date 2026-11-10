import test from "node:test";
import assert from "node:assert/strict";
import { summarizeKitchenTimings } from "./kitchen-analytics.js";

test("kitchen prep duration measures KOT fire to served per item", () => {
    const dishes = summarizeKitchenTimings([
        {
            item_name: "Paneer Tikka",
            quantity: 2,
            served_at: new Date("2024-01-08T12:30:00Z"),
            order: { createdAt: new Date("2024-01-08T12:00:00Z") },
        },
        {
            item_name: "Paneer Tikka",
            quantity: 1,
            served_at: new Date("2024-01-08T12:40:00Z"),
            order: { createdAt: new Date("2024-01-08T12:00:00Z") },
        },
    ]);

    assert.deepEqual(dishes, [{
        name: "Paneer Tikka",
        samples: 2,
        quantity: 3,
        slowOrders: 2,
        averageMinutes: 35,
    }]);
});
