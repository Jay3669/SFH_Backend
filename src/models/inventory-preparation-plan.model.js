import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import User from "./user.model.js";

const InventoryPreparationPlan = sequelize.define("inventory_preparation_plans", {
    inventory_preparation_plan_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    planned_date: { type: DataTypes.DATEONLY, allowNull: false },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: User, key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ fields: ["planned_date", "createdAt"] }],
});

export default InventoryPreparationPlan;
