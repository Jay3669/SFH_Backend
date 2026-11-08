import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryItem from "./inventory-item.model.js";
import InventoryMenuRecipeVersion from "./inventory-menu-recipe-version.model.js";

const InventoryMenuRecipeIngredient = sequelize.define("inventory_menu_recipe_ingredients", {
    inventory_menu_recipe_ingredient_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    recipe_version_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryMenuRecipeVersion, key: "inventory_menu_recipe_version_id" },
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
    quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    unit: { type: DataTypes.STRING(24), allowNull: false },
    unit_cost_snapshot: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ unique: true, fields: ["recipe_version_id", "item_id"] }],
});

export default InventoryMenuRecipeIngredient;