import assert from "node:assert/strict";
import test from "node:test";
import { calculatePosTotals } from "./pos-sales.js";

const settings = {
    packagingEnabled: false,
    packagingAmount: 0,
    taxEnabled: false,
    taxRate: 0,
    paymentMethods: { cash: true, card: true, upi: true, split: true },
    allowBalanceDue: false,
};

test("calculates packaging, tax, split tender, and change", () => {
    const totals = calculatePosTotals({
        subtotal: 200,
        discountAmount: 0,
        orderType: "Takeaway",
        packagingAmount: 20,
        paymentMethod: "Split",
        tenders: [{ method: "Cash", amount: 200 }, { method: "UPI", amount: 42 }],
        settings: { ...settings, packagingEnabled: true, taxEnabled: true, taxRate: 10 },
    });
    assert.equal(totals.subtotal, 200);
    assert.equal(totals.orderType, "Takeaway");
    assert.equal(totals.packagingAmount, 20);
    assert.equal(totals.taxAmount, 22);
    assert.equal(totals.total, 242);
    assert.equal(totals.amountPaid, 242);
    assert.equal(totals.changeDue, 0);
    assert.equal(totals.balanceDue, 0);
});

test("rounds GST half up once on the combined taxable subtotal to whole rupees", () => {
    const totals = calculatePosTotals({
        subtotal: 110.01,
        discountAmount: 0,
        paymentMethod: "Cash",
        tenders: [{ method: "Cash", amount: 116.01 }],
        settings: { ...settings, taxEnabled: true, taxRate: 5 },
    });

    assert.equal(totals.taxAmount, 6);
    assert.equal(totals.total, 116.01);
});

test("keeps payment references and allows multiple payment rows with the same method", () => {
    const totals = calculatePosTotals({
        subtotal: 200,
        discountAmount: 0,
        paymentMethod: "Split",
        tenders: [
            { method: "UPI", amount: 100, transactionRef: "upi-1" },
            { method: "UPI", amount: 100, transactionRef: "upi-2" },
        ],
        settings,
    });
    assert.deepEqual(totals.tenders.map(({ method, amount, transactionRef }) => ({ method, amount, transactionRef })), [
        { method: "UPI", amount: 100, transactionRef: "upi-1" },
        { method: "UPI", amount: 100, transactionRef: "upi-2" },
    ]);
});

test("rejects overlong or malformed transaction references", () => {
    assert.throws(() => calculatePosTotals({
        subtotal: 100,
        discountAmount: 0,
        paymentMethod: "Cash",
        tenders: [{ method: "Cash", amount: 100, transactionRef: "x".repeat(121) }],
        settings,
    }), { status: 400 });
    assert.throws(() => calculatePosTotals({
        subtotal: 100,
        discountAmount: 0,
        paymentMethod: "Cash",
        tenders: [{ method: "Cash", amount: 100, transactionRef: 42 }],
        settings,
    }), { status: 400 });
});

test("does not apply packaging to Dine-in orders and rejects unknown order types", () => {
    const totals = calculatePosTotals({
        subtotal: 200,
        discountAmount: 0,
        orderType: "Dine-in",
        packagingAmount: 20,
        paymentMethod: "Cash",
        tenders: [{ method: "Cash", amount: 220 }],
        settings: { ...settings, packagingEnabled: true, taxEnabled: true, taxRate: 10 },
    });
    assert.equal(totals.packagingAmount, 0);
    assert.equal(totals.taxAmount, 20);
    assert.equal(totals.total, 220);

    assert.throws(() => calculatePosTotals({
        subtotal: 100,
        discountAmount: 0,
        orderType: "Delivery",
        paymentMethod: "Cash",
        tenders: [{ method: "Cash", amount: 100 }],
        settings,
    }), { status: 400 });
});

test("calculates cash change and partial balance", () => {
    const change = calculatePosTotals({
        subtotal: 400,
        discountAmount: 0,
        paymentMethod: "Cash",
        tenders: [{ method: "Cash", amount: 500 }],
        settings,
    });
    assert.equal(change.changeDue, 100);
    assert.equal(change.amountPaid, 400);

    const partial = calculatePosTotals({
        subtotal: 400,
        discountAmount: 0,
        paymentMethod: "Cash",
        tenders: [{ method: "Cash", amount: 50 }],
        settings,
    });
    assert.equal(partial.balanceDue, 350);
});

test("rejects unavailable tender methods and discounts above subtotal", () => {
    assert.throws(() => calculatePosTotals({
        subtotal: 100,
        discountAmount: 0,
        paymentMethod: "Card",
        tenders: [{ method: "Card", amount: 100 }],
        settings: { ...settings, paymentMethods: { ...settings.paymentMethods, card: false } },
    }), { status: 400 });
    assert.throws(() => calculatePosTotals({
        subtotal: 100,
        discountAmount: 101,
        paymentMethod: "Cash",
        tenders: [{ method: "Cash", amount: 0 }],
        settings,
    }), { status: 400 });
});