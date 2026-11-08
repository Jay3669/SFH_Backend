import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryPurchase from "./inventory-purchase.model.js";

const InventoryPayment = sequelize.define("inventory_payments", {
    inventory_payment_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    purchase_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryPurchase, key: "inventory_purchase_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    reference: { type: DataTypes.STRING(120), allowNull: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
});

export default InventoryPayment;
