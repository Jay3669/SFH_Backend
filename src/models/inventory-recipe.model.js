import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryItem from "./inventory-item.model.js";

const InventoryRecipe = sequelize.define("inventory_recipes", {
    inventory_recipe_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    dish_name: { type: DataTypes.STRING(160), allowNull: false },
    item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryItem, key: "inventory_item_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    quantity_per_serving: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ unique: true, fields: ["dish_name", "item_id"] }],
});

export default InventoryRecipe;
