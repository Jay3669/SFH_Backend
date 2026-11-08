import "dotenv/config";
import cors from "cors";
import express from "express";
import { connectDatabase, schema, sequelize } from "./src/config/db.js";
import authRoutes from "./src/routes/auth.routes.js";
import userRoutes from "./src/routes/user.routes.js";
import menuCategoryRoutes from "./src/routes/menu-category.routes.js";
import menuItemRoutes from "./src/routes/menu-item.routes.js";
import inventoryRoutes from "./src/routes/inventory.routes.js";
import recipeWorkflowRoutes from "./src/routes/recipe-workflow.routes.js";
import posSettingsRoutes from "./src/routes/pos-settings.routes.js";
import posRoutes from "./src/routes/pos.routes.js";
import { requestLogger } from "./src/middlewares/request-logger.middleware.js";
import { flushLogs, logger } from "./src/utils/logger.js";

process.on("uncaughtException", async (error) => {
    logger.error("Uncaught exception", { message: error.message, stack: error.stack });
    await flushLogs();
    process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("Unhandled promise rejection", { message: error.message, stack: error.stack });
    await flushLogs();
    process.exit(1);
});

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({
    ...(allowedOrigins.length ? { origin: allowedOrigins, credentials: true } : {}),
}));
app.use(requestLogger);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/menu-categories", menuCategoryRoutes);
app.use("/api/menu-items", menuItemRoutes);
app.use("/api", recipeWorkflowRoutes);
app.use("/api/pos/settings", posSettingsRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/inventory", inventoryRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: "Route not found." }));
app.use((error, req, res, next) => {
    const status = error.status || (
        error.name === "SequelizeUniqueConstraintError"
            ? 409
            : error.name === "SequelizeValidationError"
                ? 400
                : 500
    );
    const message = error.name === "SequelizeUniqueConstraintError"
        ? req.path.startsWith("/api/pos")
            ? "A bill with this number or idempotency key already exists."
            : req.path.startsWith("/api/inventory")
            || req.path.startsWith("/api/recipes")
            || req.path.startsWith("/api/productions")
            ? "A record with the provided inventory details already exists."
            : "An account with the provided email or phone number already exists."
        : status < 500
            ? error.message
            : process.env.NODE_ENV === "production"
                ? "An unexpected error occurred."
                : error.message;

    logger.error("Request failed", {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status,
        message: error.message,
        stack: error.stack,
    });
    return res.status(status).json({ success: false, message });
});

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port.");
}

try {
    await connectDatabase();
    await sequelize.sync();
    await sequelize.query(`
        ALTER TABLE "${schema}"."inventory_movements"
        ADD COLUMN IF NOT EXISTS unit_cost_snapshot NUMERIC(12, 2),
        ADD COLUMN IF NOT EXISTS total_cost_snapshot NUMERIC(14, 2)
    `);
    await sequelize.query(`
        ALTER TABLE "${schema}"."pos_sales"
        ADD COLUMN IF NOT EXISTS order_type VARCHAR(16) NOT NULL DEFAULT 'Dine-in'
    `);
    app.listen(port, () => logger.info(`Server listening on port ${port}`));
} catch (error) {
    logger.error("Failed to start server", { message: error.message, stack: error.stack });
    await flushLogs();
    process.exitCode = 1;
}