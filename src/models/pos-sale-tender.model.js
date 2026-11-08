import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import PosSale from "./pos-sale.model.js";

const PosSaleTender = sequelize.define("pos_sale_tenders", {
    pos_sale_tender_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    sale_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: PosSale, key: "pos_sale_id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    method: { type: DataTypes.STRING(16), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ fields: ["sale_id"] }],
});

export default PosSaleTender;