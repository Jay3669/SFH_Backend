import assert from "node:assert/strict";
import test from "node:test";
import { convertQuantity } from "./recipe-units.js";

test("converts mass units to the inventory unit", () => {
    assert.equal(convertQuantity(500, "g", "kg"), 0.5);
    assert.equal(convertQuantity(1, "kg", "g"), 1000);
});

test("converts volume and count aliases", () => {
    assert.equal(convertQuantity(250, "ml", "litre"), 0.25);
    assert.equal(convertQuantity(200, "ml", "L"), 0.2);
    assert.equal(convertQuantity(200, "grms", "kg"), 0.2);
    assert.equal(convertQuantity(2, "pieces", "pcs"), 2);
    assert.equal(convertQuantity(2, "dozen", "pcs"), 24);
});

test("allows identical custom units and rejects incompatible units", () => {
    assert.equal(convertQuantity(3, "tray", "TRAY"), 3);
    assert.throws(() => convertQuantity(1, "kg", "litre"), { status: 400 });
});
