import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
    const secret = process.env.PUBLIC_ORDER_TOKEN_SECRET;
    if (!secret || secret.length < 32) {
        throw Object.assign(new Error("PUBLIC_ORDER_TOKEN_SECRET must contain at least 32 characters."), { status: 503 });
    }
    return createHash("sha256").update(secret).digest();
}

export function createTableOrderToken(tableName, now = Date.now()) {
    const days = Number(process.env.PUBLIC_ORDER_TOKEN_DAYS || 365);
    if (!Number.isInteger(days) || days < 1 || days > 730) {
        throw Object.assign(new Error("PUBLIC_ORDER_TOKEN_DAYS must be between 1 and 730."), { status: 503 });
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const payload = Buffer.from(JSON.stringify({
        tableName,
        expiresAt: now + days * 24 * 60 * 60 * 1000,
    }));
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    return [
        "v1",
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
    ].join(".");
}

export function readTableOrderToken(token, now = Date.now()) {
    try {
        const [version, ivText, tagText, ciphertextText, extra] = String(token).split(".");
        if (version !== "v1" || !ivText || !tagText || !ciphertextText || extra) throw new Error("Invalid table token.");
        const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
        decipher.setAuthTag(Buffer.from(tagText, "base64url"));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(ciphertextText, "base64url")),
            decipher.final(),
        ]);
        const payload = JSON.parse(plaintext.toString("utf8"));
        if (typeof payload.tableName !== "string" || !payload.tableName || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) {
            throw new Error("Invalid or expired table token.");
        }
        return payload.tableName;
    } catch (error) {
        if (error.status) throw error;
        throw Object.assign(new Error("This table QR code is invalid or has expired."), { status: 401 });
    }
}
