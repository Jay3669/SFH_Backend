import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import User from "./user.model.js";

const CashDrawer = sequelize.define("cash_drawers", {
    drawer_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    business_date: { type: DataTypes.DATEONLY, allowNull: false },
    cashier_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: User, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    opening_balance: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    actual_cash: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    expected_cash: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    variance: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    cash_taken: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "open" },
    opened_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    closed_at: { type: DataTypes.DATE, allowNull: true },
    handed_over_to: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: User, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
    },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [
        { fields: ["cashier_id", "business_date"] },
        { fields: ["status", "opened_at"] },
    ],
});

export default CashDrawer;
