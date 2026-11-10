import test from "node:test";
import assert from "node:assert/strict";
import {
    assertTableStatusTransition,
    assertTableTransferAllowed,
    normalizeTableName,
} from "./table-management.js";

test("normalizes table names and rejects empty or oversized names", () => {
    assert.equal(normalizeTableName(" Table 4 "), "Table 4");
    assert.throws(() => normalizeTableName("  "), /required/);
    assert.throws(() => normalizeTableName("T".repeat(65)), /64 characters/);
});

test("move and merge require the appropriate source and destination states", () => {
    assert.doesNotThrow(() => assertTableTransferAllowed("move", "occupied", "vacant"));
    assert.doesNotThrow(() => assertTableTransferAllowed("merge", "occupied", "occupied"));
    assert.throws(() => assertTableTransferAllowed("move", "occupied", "occupied"), /must be vacant/);
    assert.throws(() => assertTableTransferAllowed("merge", "occupied", "vacant"), /must be occupied/);
    assert.throws(() => assertTableTransferAllowed("merge", "vacant", "occupied"), /Only an occupied/);
});

test("table status follows the billing and cleaning lifecycle", () => {
    assert.doesNotThrow(() => assertTableStatusTransition("occupied", "billed"));
    assert.doesNotThrow(() => assertTableStatusTransition("billed", "dirty/cleaning"));
    assert.doesNotThrow(() => assertTableStatusTransition("dirty/cleaning", "vacant"));
    assert.throws(() => assertTableStatusTransition("occupied", "vacant"), /cannot be changed/);
    assert.throws(() => assertTableStatusTransition("vacant", "unknown"), /status must be one of/);
});
