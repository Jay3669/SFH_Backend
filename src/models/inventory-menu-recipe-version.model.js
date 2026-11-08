import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryMenuRecipe from "./inventory-menu-recipe.model.js";
import User from "./user.model.js";

const InventoryMenuRecipeVersion = sequelize.define("inventory_menu_recipe_versions", {
    inventory_menu_recipe_version_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    recipe_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryMenuRecipe, key: "inventory_menu_recipe_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    version_number: { type: DataTypes.INTEGER, allowNull: false },
    base_production_quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    production_unit: { type: DataTypes.STRING(24), allowNull: false },
    preparation_instructions: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: User, key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ unique: true, fields: ["recipe_id", "version_number"] }],
});

export default InventoryMenuRecipeVersion;