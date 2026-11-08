import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryMenuRecipe from "./inventory-menu-recipe.model.js";
import InventoryMenuRecipeVersion from "./inventory-menu-recipe-version.model.js";
import User from "./user.model.js";

const InventoryProduction = sequelize.define("inventory_productions", {
    inventory_production_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    production_number: { type: DataTypes.STRING(48), allowNull: false, unique: true },
    recipe_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryMenuRecipe, key: "inventory_menu_recipe_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    recipe_version_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryMenuRecipeVersion, key: "inventory_menu_recipe_version_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    recipe_name_snapshot: { type: DataTypes.STRING(160), allowNull: false },
    production_quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    production_unit: { type: DataTypes.STRING(24), allowNull: false },
    production_date: { type: DataTypes.DATEONLY, allowNull: false },
    status: { type: DataTypes.ENUM("Draft", "Confirmed", "Cancelled"), allowNull: false, defaultValue: "Draft" },
    total_cost: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    idempotency_key: { type: DataTypes.STRING(120), allowNull: true, unique: true },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: User, key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: User, key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
    confirmed_at: { type: DataTypes.DATE, allowNull: true },
    cancelled_at: { type: DataTypes.DATE, allowNull: true },
    cancellation_reason: { type: DataTypes.TEXT, allowNull: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [
        { fields: ["production_date", "status"] },
        { fields: ["recipe_id", "production_date"] },
    ],
});

export default InventoryProduction;
