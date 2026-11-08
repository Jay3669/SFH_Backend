import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryBatch from "./inventory-batch.model.js";
import InventoryProductionIngredient from "./inventory-production-ingredient.model.js";

const InventoryProductionBatchAllocation = sequelize.define("inventory_production_batch_allocations", {
    inventory_production_batch_allocation_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    production_ingredient_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryProductionIngredient, key: "inventory_production_ingredient_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    batch_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: InventoryBatch, key: "inventory_batch_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    batch_code_snapshot: { type: DataTypes.STRING(100), allowNull: false },
    quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ fields: ["production_ingredient_id"] }],
});

export default InventoryProductionBatchAllocation;
