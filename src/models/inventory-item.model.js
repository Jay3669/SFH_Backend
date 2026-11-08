import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import InventoryCategory from "./inventory-category.model.js";

const InventoryItem = sequelize.define(
  "inventory_items",
  {
    inventory_item_id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    category_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: InventoryCategory, key: "inventory_category_id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    name: { type: DataTypes.STRING(160), allowNull: false },
    unit: { type: DataTypes.STRING(24), allowNull: false },
    quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },
    reorder_level: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },
    unit_cost: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ unique: true, fields: ["category_id", "name"] }],
  },
);

export default InventoryItem;
