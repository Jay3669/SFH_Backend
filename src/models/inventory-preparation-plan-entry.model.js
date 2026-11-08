import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryPreparationPlan from "./inventory-preparation-plan.model.js";
import InventoryMenuRecipe from "./inventory-menu-recipe.model.js";
import InventoryMenuRecipeVersion from "./inventory-menu-recipe-version.model.js";

const InventoryPreparationPlanEntry = sequelize.define("inventory_preparation_plan_entries", {
    inventory_preparation_plan_entry_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    plan_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryPreparationPlan, key: "inventory_preparation_plan_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
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
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
});

export default InventoryPreparationPlanEntry;
