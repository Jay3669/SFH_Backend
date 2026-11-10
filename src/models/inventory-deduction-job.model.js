import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import PosSale from "./pos-sale.model.js";

const InventoryDeductionJob = sequelize.define("inventory_deduction_jobs", {
    inventory_deduction_job_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    sale_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
        references: { model: PosSale, key: "pos_sale_id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    requirements: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    warnings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "pending" },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    available_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    last_error: { type: DataTypes.TEXT, allowNull: true },
    processed_at: { type: DataTypes.DATE, allowNull: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ fields: ["status", "available_at"] }],
});

export default InventoryDeductionJob;
