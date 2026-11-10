import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import CashDrawer from "./cash-drawer.model.js";
import User from "./user.model.js";

const ShiftLog = sequelize.define("shift_logs", {
    shift_log_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    drawer_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: CashDrawer, key: "drawer_id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    cashier_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: User, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    target_cashier_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: User, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
    },
    event_type: { type: DataTypes.STRING(24), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    expected_cash: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    actual_cash: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    variance: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    description: { type: DataTypes.STRING(120), allowNull: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ fields: ["drawer_id", "createdAt"] }],
});

export default ShiftLog;
