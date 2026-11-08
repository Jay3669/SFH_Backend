import { appendFile, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultLogDirectory = fileURLToPath(new URL("../../logs/", import.meta.url));
const logDirectory = resolve(process.env.LOG_DIR || defaultLogDirectory);
const pendingWrites = new Set();

mkdirSync(logDirectory, { recursive: true });

function log(level, message, details) {
    const record = {
        timestamp: new Date().toISOString(),
        level,
        message: String(message),
        ...(details === undefined ? {} : { details }),
    };

    let line;
    try {
        line = `${JSON.stringify(record)}\n`;
    } catch (error) {
        line = `${JSON.stringify({
            timestamp: record.timestamp,
            level,
            message: String(message),
            details: "[Unable to serialize log details]",
        })}\n`;
        console.error("Failed to serialize log details", error.message);
    }

    if (level === "error") console.error(line.trimEnd());
    else if (level === "warn") console.warn(line.trimEnd());
    else if (level === "debug") console.debug(line.trimEnd());
    else console.info(line.trimEnd());

    const date = record.timestamp.slice(0, 10);
    const files = [`app-${date}.log`];
    if (level === "error") files.push(`error-${date}.log`);

    for (const file of files) {
        const write = new Promise((resolveWrite) => {
            appendFile(resolve(logDirectory, file), line, (error) => {
                if (error) console.error(`Failed to write log file ${file}: ${error.message}`);
                resolveWrite();
            });
        });
        pendingWrites.add(write);
        write.then(() => pendingWrites.delete(write));
    }
}

export const logger = {
    debug(message, details) {
        log("debug", message, details);
    },
    info(message, details) {
        log("info", message, details);
    },
    warn(message, details) {
        log("warn", message, details);
    },
    error(message, details) {
        log("error", message, details);
    },
};

export async function flushLogs() {
    await Promise.all([...pendingWrites]);
}
