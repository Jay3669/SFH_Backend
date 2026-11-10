import "dotenv/config";
import { DataTypes } from "sequelize";
import { connectDatabase, schema, sequelize } from "../config/db.js";
import { flushLogs, logger } from "../utils/logger.js";

try {
    await connectDatabase();
    const queryInterface = sequelize.getQueryInterface();
    const table = { tableName: "pos_sale_items", schema };
    const columns = await queryInterface.describeTable(table);

    if (!columns.notes) {
        await queryInterface.addColumn(table, "notes", {
            type: DataTypes.STRING(300),
            allowNull: true,
        });
        logger.info("Added item preparation notes to POS sale items", { schema });
    } else {
        logger.info("POS sale item notes column is already present", { schema });
    }
} catch (error) {
    logger.error("Failed to migrate POS sale item notes", { message: error.message, stack: error.stack });
    process.exitCode = 1;
} finally {
    await sequelize.close();
    await flushLogs();
}
