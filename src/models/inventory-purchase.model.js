import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventorySupplier from "./inventory-supplier.model.js";
import InventoryItem from "./inventory-item.model.js";

const InventoryPurchase = sequelize.define("inventory_purchases", {
    inventory_purchase_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    order_number: { type: DataTypes.STRING(40), allowNull: false, unique: true },
    supplier_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventorySupplier, key: "inventory_supplier_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    supplier_name: { type: DataTypes.STRING(160), allowNull: false },
    item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryItem, key: "inventory_item_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    item_name: { type: DataTypes.STRING(160), allowNull: false },
    unit: { type: DataTypes.STRING(24), allowNull: false },
    quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    received_quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
    unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    invoice_reference: { type: DataTypes.STRING(120), allowNull: false },
    expiry_date: { type: DataTypes.DATEONLY, allowNull: true },
    status: { type: DataTypes.ENUM("Ordered", "Partially received", "Received", "Cancelled"), allowNull: false, defaultValue: "Ordered" },
    paid_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    order_date: { type: DataTypes.DATEONLY, allowNull: false },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
});

export default InventoryPurchase;
