import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import MenuItem from "./menu-item.model.js";
import PosSale from "./pos-sale.model.js";

const PosSaleItem = sequelize.define("pos_sale_items", {
    pos_sale_item_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    sale_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: PosSale, key: "pos_sale_id" },
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
    unit_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    line_total: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ fields: ["sale_id"] }],
});

export default PosSaleItem;