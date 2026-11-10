import test from "node:test";
import assert from "node:assert/strict";
import {
    calculatePromotionDiscountForRules,
    isRuleActive,
    validatePromotion,
} from "./happy-hour-rules.js";

const mondayPromotion = {
    category_id: "4",
    discount_percent: 20,
    days_of_week: [1, 2, 3, 4],
    start_time: "16:00:00",
    end_time: "19:00:00",
    is_active: true,
};

test("promotion schedule uses Asia/Kolkata time with inclusive start and exclusive end", () => {
    assert.equal(isRuleActive(mondayPromotion, new Date("2024-01-08T10:30:00.000Z")), true);
    assert.equal(isRuleActive(mondayPromotion, new Date("2024-01-08T13:30:00.000Z")), false);
    assert.equal(isRuleActive(mondayPromotion, new Date("2024-01-07T10:30:00.000Z")), false);
});

test("overnight promotion windows continue from the selected weekday", () => {
    const overnight = { ...mondayPromotion, days_of_week: [1], start_time: "22:00:00", end_time: "02:00:00" };
    assert.equal(isRuleActive(overnight, new Date("2024-01-08T17:00:00.000Z")), true);
    assert.equal(isRuleActive(overnight, new Date("2024-01-08T19:30:00.000Z")), true);
    assert.equal(isRuleActive(overnight, new Date("2024-01-09T03:00:00.000Z")), false);
});

test("discount calculation applies the best active category promotion once and skips comps", () => {
    const lowerOffer = { ...mondayPromotion, discount_percent: 10 };
    const higherOffer = { ...mondayPromotion, discount_percent: 20 };
    const { discountAmount, rules } = calculatePromotionDiscountForRules([
        { menuItem: { category_id: "4", price: 99.99 }, quantity: 2 },
        { menuItem: { category_id: "4", price: 100 }, quantity: 1, isComp: true },
        { menuItem: { category_id: "9", price: 200 }, quantity: 1 },
    ], [lowerOffer, higherOffer], new Date("2024-01-08T10:30:00.000Z"));

    assert.equal(discountAmount, 40);
    assert.equal(rules.length, 2);
});

test("promotion rules reject invalid date ranges, weekdays, and percentages", () => {
    const valid = {
        name: "After work",
        categoryId: "4",
        discountPercent: 20,
        daysOfWeek: [1, 2, 3],
        startTime: "16:00",
        endTime: "19:00",
    };
    assert.throws(() => validatePromotion({ ...valid, effectiveFrom: "2024-99-99" }), /valid YYYY-MM-DD/);
    assert.throws(() => validatePromotion({ ...valid, daysOfWeek: [null] }), /weekday/);
    assert.throws(() => validatePromotion({ ...valid, discountPercent: 101 }), /discount percentage/i);
});
