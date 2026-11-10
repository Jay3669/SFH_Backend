import test from "node:test";
import assert from "node:assert/strict";
import { createTableOrderToken, readTableOrderToken } from "./table-order-token.js";

test("table QR token encrypts table identity and authenticates token contents", () => {
    process.env.PUBLIC_ORDER_TOKEN_SECRET = "table-order-test-secret-that-is-long-enough";
    const token = createTableOrderToken("Table 12", 1000);

    assert.equal(token.includes("Table 12"), false);
    assert.equal(readTableOrderToken(token, 1001), "Table 12");
    const [version, iv, tag, ciphertext] = token.split(".");
    const alteredTag = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
    assert.throws(() => readTableOrderToken([version, iv, alteredTag, ciphertext].join(".")), /invalid or has expired/i);
});

test("table QR token expires after configured lifetime", () => {
    process.env.PUBLIC_ORDER_TOKEN_SECRET = "table-order-test-secret-that-is-long-enough";
    const token = createTableOrderToken("Table 12", 1000);

    assert.throws(() => readTableOrderToken(token, 1000 + 366 * 24 * 60 * 60 * 1000), /invalid or has expired/i);
});
