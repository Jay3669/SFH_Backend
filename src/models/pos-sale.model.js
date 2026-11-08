import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import User from "./user.model.js";

const PosSale = sequelize.define("pos_sales", {
    pos_sale_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    bill_number: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    idempotency_key: { type: DataTypes.STRING(120), allowNull: true, unique: true },
    status: { type: DataTypes.STRING(24), allowNull: false },
    subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    discount_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    packaging_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    tax_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    tax_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
    total_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    order_type: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "Dine-in" },
    amount_tendered: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    amount_paid: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    change_due: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    balance_due: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    payment_method: { type: DataTypes.STRING(16), allowNull: false },
    stock_deducted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    stock_warnings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    completed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    created_by: {
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
    indexes: [{ fields: ["completed_at"] }],
});

export default PosSale;