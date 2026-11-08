import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryItem from "./inventory-item.model.js";
import InventoryProduction from "./inventory-production.model.js";

const InventoryProductionIngredient = sequelize.define("inventory_production_ingredients", {
    inventory_production_ingredient_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    production_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryProduction, key: "inventory_production_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryItem, key: "inventory_item_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    ingredient_name_snapshot: { type: DataTypes.STRING(160), allowNull: false },
    required_quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    unit: { type: DataTypes.STRING(24), allowNull: false },
    unit_cost_snapshot: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
    total_cost_snapshot: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ unique: true, fields: ["production_id", "item_id"] }],
});

export default InventoryProductionIngredient;
