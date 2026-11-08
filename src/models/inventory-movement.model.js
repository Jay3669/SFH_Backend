import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryItem from "./inventory-item.model.js";

const InventoryMovement = sequelize.define("inventory_movements", {
    inventory_movement_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryItem, key: "inventory_item_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    movement_type: { type: DataTypes.STRING(40), allowNull: false },
    quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    unit_cost_snapshot: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    total_cost_snapshot: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    reason: { type: DataTypes.TEXT, allowNull: false },
    batch_code: { type: DataTypes.STRING(100), allowNull: true },
    expiry_date: { type: DataTypes.DATEONLY, allowNull: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
});

export default InventoryMovement;
