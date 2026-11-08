import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import MenuCategory from "./menu-category.model.js";

const MenuItem = sequelize.define(
    "menu_items",
    {
        menu_item_id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        category_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            references: {
                model: MenuCategory,
                key: "category_id",
            },
            onUpdate: "CASCADE",
            onDelete: "RESTRICT",
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
        },
        is_available: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        image_url: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        food_type: {
            type: DataTypes.ENUM("Veg", "Non-Veg"),
            allowNull: false,
        },
    },
    {
        schema,
        timestamps: true,
        freezeTableName: true,
    },
);

MenuItem.belongsTo(MenuCategory, {
    foreignKey: "category_id",
    as: "category",
});

export default MenuItem;
