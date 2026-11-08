import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryItem from "./inventory-item.model.js";

const InventoryBatch = sequelize.define("inventory_batches", {
    inventory_batch_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryItem, key: "inventory_item_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    batch_code: { type: DataTypes.STRING(100), allowNull: false },
    quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
    unit_cost: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    expiry_date: { type: DataTypes.DATEONLY, allowNull: true },
    received_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ unique: true, fields: ["item_id", "batch_code"] }],
});

export default InventoryBatch;
