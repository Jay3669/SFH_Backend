import assert from "node:assert/strict";
import test from "node:test";
import { getBillingPeriodRange, summarizeBillingReport } from "./billing-report.js";

test("builds daily, Monday-to-Sunday weekly, and monthly ranges in India time", () => {
    const now = new Date("2026-11-07T13:15:00.000Z");
    assert.deepEqual(getBillingPeriodRange("daily", now), {
        from: "2026-11-07",
        to: "2026-11-07",
        endExclusive: "2026-11-08",
        startAt: "2026-11-06T18:30:00.000Z",
        endAt: "2026-11-07T18:30:00.000Z",
    });
    assert.deepEqual(getBillingPeriodRange("weekly", now), {
        from: "2026-11-02",
        to: "2026-11-08",
        endExclusive: "2026-11-09",
        startAt: "2026-11-01T18:30:00.000Z",
        endAt: "2026-11-08T18:30:00.000Z",
    });
    assert.deepEqual(getBillingPeriodRange("monthly", now), {
        from: "2026-11-01",
        to: "2026-11-30",
        endExclusive: "2026-12-01",
        startAt: "2026-10-31T18:30:00.000Z",
        endAt: "2026-11-30T18:30:00.000Z",
    });
});

test("rejects unknown report periods and sums purchase and sales totals", () => {
    assert.throws(() => getBillingPeriodRange("yearly"), { status: 400 });
    assert.deepEqual(summarizeBillingReport([{ total: 12.35 }, { total: 2.65 }], [{ total: 30 }]), {
        purchases: { count: 2, total: 15, bills: [{ total: 12.35 }, { total: 2.65 }] },
        sales: { count: 1, total: 30, bills: [{ total: 30 }] },
        grandTotal: 45,
    });
});
