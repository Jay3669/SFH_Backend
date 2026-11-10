import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import PosSale from "./pos-sale.model.js";

const OrderPayment = sequelize.define("order_payments", {
    order_payment_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    order_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: PosSale, key: "pos_sale_id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    payment_mode: { type: DataTypes.STRING(16), allowNull: false },
    transaction_ref: { type: DataTypes.STRING(120), allowNull: true },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ fields: ["order_id"] }],
});

export default OrderPayment;
