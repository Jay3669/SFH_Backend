import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import kotRoutes from "./src/routes/kot.routes.js";
import diningTableRoutes from "./src/routes/dining-table.routes.js";
import { connectDatabase, schema, sequelize } from "./src/config/db.js";
import authRoutes from "./src/routes/auth.routes.js";
import userRoutes from "./src/routes/user.routes.js";
import menuCategoryRoutes from "./src/routes/menu-category.routes.js";
import menuItemRoutes from "./src/routes/menu-item.routes.js";
import inventoryRoutes from "./src/routes/inventory.routes.js";
import recipeWorkflowRoutes from "./src/routes/recipe-workflow.routes.js";
import posSettingsRoutes from "./src/routes/pos-settings.routes.js";
import posRoutes from "./src/routes/pos.routes.js";
import cashDrawerRoutes from "./src/routes/cash-drawer.routes.js";
import promotionRoutes from "./src/routes/promotion.routes.js";
import kitchenAnalyticsRoutes from "./src/routes/kitchen-analytics.routes.js";
import aggregatorRoutes from "./src/routes/aggregator.routes.js";
import publicRoutes from "./src/routes/public.routes.js";
import { requestLogger } from "./src/middlewares/request-logger.middleware.js";
import { attachKitchenSocket } from "./src/services/kitchen-socket.js";
import { startInventoryConsumptionWorker } from "./src/services/inventory-consumption.js";
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
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
}));
app.use(requestLogger);
app.use(express.json({
    limit: "1mb",
    verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer); },
}));

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/menu-categories", menuCategoryRoutes);
app.use("/api/menu-items", menuItemRoutes);
app.use("/api", recipeWorkflowRoutes);
app.use("/api/pos/settings", posSettingsRoutes);
app.use("/api/pos/cash-drawers", cashDrawerRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/pos/kots", kotRoutes);
app.use("/api/pos/tables", diningTableRoutes);
app.use("/api/pos/promotions", promotionRoutes);
app.use("/api/analytics/kitchen", kitchenAnalyticsRoutes);
app.use("/api/aggregator", aggregatorRoutes);
app.use("/api", publicRoutes);
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
        ? req.path.startsWith("/api/pos/kots")
            ? "A KOT with this idempotency key and station already exists."
            : req.path.startsWith("/api/pos/tables")
                ? "A table with the provided name already exists."
            : req.path.startsWith("/api/pos")
            ? "A bill with this number or idempotency key already exists."
            : req.path.startsWith("/api/aggregator")
                ? "This aggregator order already exists."
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

const server = createServer(app);
attachKitchenSocket(server, allowedOrigins);

try {
    await connectDatabase();
    await sequelize.sync();
    await sequelize.query(`
        INSERT INTO "${schema}"."dining_tables" (table_name, "createdAt", "updatedAt")
        SELECT DISTINCT kot.table_name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM "${schema}"."kot_orders" AS kot
        ON CONFLICT (table_name) DO NOTHING
    `);
    await sequelize.query(`
        UPDATE "${schema}"."dining_tables" AS dining_table
        SET status = 'occupied', "updatedAt" = CURRENT_TIMESTAMP
        WHERE dining_table.status = 'vacant'
            AND EXISTS (
                SELECT 1
                FROM "${schema}"."kot_orders" AS kot
                WHERE kot.table_name = dining_table.table_name
                    AND kot.status <> 'served'
            )
    `);
    await sequelize.query(`
        ALTER TABLE "${schema}"."menu_items"
        ADD COLUMN IF NOT EXISTS kitchen_station VARCHAR(32) NOT NULL DEFAULT 'Curry'
    `);
    await sequelize.query(`
        ALTER TABLE "${schema}"."inventory_movements"
        ADD COLUMN IF NOT EXISTS unit_cost_snapshot NUMERIC(12, 2),
        ADD COLUMN IF NOT EXISTS total_cost_snapshot NUMERIC(14, 2)
    `);
    await sequelize.query(`
        ALTER TABLE "${schema}"."pos_sales"
        ADD COLUMN IF NOT EXISTS order_type VARCHAR(16) NOT NULL DEFAULT 'Dine-in',
        ADD COLUMN IF NOT EXISTS stock_deduction_status VARCHAR(24) NOT NULL DEFAULT 'completed',
        ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20),
        ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS promotional_discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0
    `);
    await sequelize.query(`
        ALTER TABLE "${schema}"."kot_items"
        ADD COLUMN IF NOT EXISTS cooking_started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS served_at TIMESTAMPTZ
    `);
    await sequelize.query(`
        ALTER TABLE "${schema}"."kot_orders"
        ADD COLUMN IF NOT EXISTS order_type VARCHAR(16) NOT NULL DEFAULT 'Dine-in'
    `);
    await sequelize.query(`
        CREATE INDEX IF NOT EXISTS "kot_items_served_at_idx"
        ON "${schema}"."kot_items" ("served_at")
    `);
    await sequelize.query(`
        ALTER TABLE "${schema}"."users"
        ADD COLUMN IF NOT EXISTS manager_pin_hash VARCHAR(100)
    `);
    await sequelize.query(`
        ALTER TABLE "${schema}"."pos_sale_items"
        ADD COLUMN IF NOT EXISTS is_comp BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await sequelize.query(`
        UPDATE "${schema}"."pos_sales" AS sale
        SET stock_deduction_status = CASE
            WHEN sale.status = 'Partially paid' THEN 'awaiting_payment'
            ELSE 'completed'
        END
        WHERE NOT EXISTS (
            SELECT 1
            FROM "${schema}"."inventory_deduction_jobs" AS job
            WHERE job.sale_id = sale.pos_sale_id
        )
    `);
    startInventoryConsumptionWorker();
    server.listen(port, () => logger.info(`Server listening on port ${port}`));
} catch (error) {
    logger.error("Failed to start server", { message: error.message, stack: error.stack });
    await flushLogs();
    process.exitCode = 1;
}