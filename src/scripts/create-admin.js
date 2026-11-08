import "dotenv/config";
import bcrypt from "bcrypt";
import { connectDatabase, sequelize } from "../config/db.js";
import User from "../models/user.model.js";
import { flushLogs, logger } from "../utils/logger.js";

async function createInitialAdmin() {
    const first_name = process.env.ADMIN_FIRST_NAME?.trim();
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!first_name || !email || !password) {
        throw new Error("Set ADMIN_FIRST_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD to create the initial admin.");
    }
    if (password.length < 8) {
        throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
    }

    await connectDatabase();
    await sequelize.sync();

    const existingAdmin = await User.findOne({ where: { role: "Admin" } });
    if (existingAdmin) {
        throw new Error("An Admin account already exists; refusing to create another initial admin.");
    }

    const user = await User.create({
        first_name,
        email,
        password: await bcrypt.hash(password, 12),
        role: "Admin",
        status: "active",
        is_verified: true,
        is_subscribed: false,
    });

    logger.info("Initial Admin account created", { userId: String(user.id) });
}

try {
    await createInitialAdmin();
} catch (error) {
    logger.error("Failed to create initial Admin", { message: error.message, stack: error.stack });
    process.exitCode = 1;
} finally {
    await sequelize.close();
    await flushLogs();
}
