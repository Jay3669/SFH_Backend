import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";

const InventoryCategory = sequelize.define(
    "inventory_categories",
    {
        inventory_category_id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        schema,
        timestamps: true,
        freezeTableName: true,
    },
);

export default InventoryCategory;
