import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";

const MenuCategory = sequelize.define(
    "menu_categories",
    {
        category_id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        category_name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: "menu_categories_category_name_unique",
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        display_order: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    },
    {
        schema,
        timestamps: true,
        freezeTableName: true,
    }
);

export default MenuCategory;
