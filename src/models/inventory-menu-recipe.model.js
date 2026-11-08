import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import MenuItem from "./menu-item.model.js";
import User from "./user.model.js";

const InventoryMenuRecipe = sequelize.define("inventory_menu_recipes", {
    inventory_menu_recipe_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    menu_item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: MenuItem, key: "menu_item_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    recipe_name: { type: DataTypes.STRING(160), allowNull: false },
    current_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: User, key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: User, key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ unique: true, fields: ["menu_item_id", "recipe_name"] }],
});

export default InventoryMenuRecipe;
