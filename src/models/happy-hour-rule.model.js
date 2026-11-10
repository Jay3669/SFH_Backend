import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import MenuCategory from "./menu-category.model.js";

const HappyHourRule = sequelize.define("happy_hour_rules", {
    happy_hour_rule_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    category_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: MenuCategory, key: "category_id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    discount_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
    days_of_week: { type: DataTypes.JSONB, allowNull: false },
    start_time: { type: DataTypes.TIME, allowNull: false },
    end_time: { type: DataTypes.TIME, allowNull: false },
    effective_from: { type: DataTypes.DATEONLY, allowNull: true },
    effective_until: { type: DataTypes.DATEONLY, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ fields: ["category_id", "is_active"] }],
});

HappyHourRule.belongsTo(MenuCategory, { foreignKey: "category_id", as: "category" });

export default HappyHourRule;
