import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import KotOrder from "./kot-order.model.js";
import MenuItem from "./menu-item.model.js";

const KotItem = sequelize.define("kot_items", {
    kot_item_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    kot_number: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: KotOrder, key: "kot_number" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    menu_item_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: MenuItem, key: "menu_item_id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
    },
    item_name: { type: DataTypes.STRING(160), allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    notes: { type: DataTypes.STRING(300), allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "pending" },
    cooking_started_at: { type: DataTypes.DATE, allowNull: true },
    ready_at: { type: DataTypes.DATE, allowNull: true },
    served_at: { type: DataTypes.DATE, allowNull: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [
        { fields: ["kot_number"] },
        { fields: ["status"] },
        { fields: ["served_at"], name: "kot_items_served_at_idx" },
    ],
});

KotOrder.hasMany(KotItem, { foreignKey: "kot_number", as: "items" });
KotItem.belongsTo(KotOrder, { foreignKey: "kot_number", as: "order" });

export default KotItem;
