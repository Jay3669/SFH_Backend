import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

export function requestLogger(req, res, next) {
    const requestId = randomUUID();
    const startedAt = process.hrtime.bigint();

    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const details = {
            requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Number(durationMs.toFixed(2)),
            ip: req.socket.remoteAddress,
        };

        if (res.statusCode >= 500) logger.error("HTTP request failed", details);
        else if (res.statusCode >= 400) logger.warn("HTTP request returned a client error", details);
        else logger.info("HTTP request completed", details);
    });

    return next();
}
