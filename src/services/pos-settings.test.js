import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_POS_SETTINGS, normalizePosSettings } from "./pos-settings.js";

test("normalizes valid POS settings", () => {
    assert.deepEqual(normalizePosSettings({
        ...DEFAULT_POS_SETTINGS,
        packagingEnabled: true,
        packagingAmount: "18.50",
        taxEnabled: true,
        taxRate: "5",
        paymentMethods: { cash: true, card: false, upi: true, split: true },
        allowBalanceDue: true,
    }), {
        ...DEFAULT_POS_SETTINGS,
        packagingEnabled: true,
        packagingAmount: 18.5,
        taxEnabled: true,
        taxRate: 5,
        paymentMethods: { cash: true, card: false, upi: true, split: true },
        allowBalanceDue: true,
    });
});

test("rejects invalid tax and disabling every payment method", () => {
    assert.throws(() => normalizePosSettings({
        ...DEFAULT_POS_SETTINGS,
        taxRate: 101,
    }), { status: 400 });
    assert.throws(() => normalizePosSettings({
        ...DEFAULT_POS_SETTINGS,
        paymentMethods: { cash: false, card: false, upi: false, split: false },
    }), { status: 400 });
});

test("normalizes bill numbering and defaults fields missing from saved settings", () => {
    const { billNumberPrefix, nextBillNumber, ...legacySettings } = DEFAULT_POS_SETTINGS;
    assert.deepEqual(normalizePosSettings(legacySettings), DEFAULT_POS_SETTINGS);
    assert.deepEqual(normalizePosSettings({
        ...DEFAULT_POS_SETTINGS,
        billNumberPrefix: " SFH/ ",
        nextBillNumber: "42",
    }), {
        ...DEFAULT_POS_SETTINGS,
        billNumberPrefix: "SFH/",
        nextBillNumber: 42,
    });
});

test("rejects invalid bill number prefixes and next numbers", () => {
    assert.throws(() => normalizePosSettings({
        ...DEFAULT_POS_SETTINGS,
        billNumberPrefix: "bad prefix",
    }), { status: 400 });
    assert.throws(() => normalizePosSettings({
        ...DEFAULT_POS_SETTINGS,
        nextBillNumber: "1.5",
    }), { status: 400 });
});

test("normalizes date and time formats and defaults them for existing settings", () => {
    const { dateFormat, timeFormat, ...legacySettings } = DEFAULT_POS_SETTINGS;
    assert.deepEqual(normalizePosSettings(legacySettings), DEFAULT_POS_SETTINGS);
    for (const dateFormat of ["YYYY-MM-DD", "DD-MM-YYYY", "MM-DD-YYYY", "DD MMM YYYY", "MMMM DD, YYYY"]) {
        assert.equal(normalizePosSettings({ ...DEFAULT_POS_SETTINGS, dateFormat }).dateFormat, dateFormat);
    }
    assert.deepEqual(normalizePosSettings({ ...DEFAULT_POS_SETTINGS, dateFormat: "YYYY-MM-DD", timeFormat: "24-hour" }), {
        ...DEFAULT_POS_SETTINGS,
        dateFormat: "YYYY-MM-DD",
        timeFormat: "24-hour",
    });
});

test("rejects unsupported date and time formats", () => {
    assert.throws(() => normalizePosSettings({
        ...DEFAULT_POS_SETTINGS,
        dateFormat: "DD-MON-YYYY",
    }), { status: 400 });
    assert.throws(() => normalizePosSettings({
        ...DEFAULT_POS_SETTINGS,
        timeFormat: "24",
    }), { status: 400 });
});