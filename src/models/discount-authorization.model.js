import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import PosSale from "./pos-sale.model.js";
import User from "./user.model.js";

const DiscountAuthorization = sequelize.define("discount_authorizations", {
    discount_authorization_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    order_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
        references: { model: PosSale, key: "pos_sale_id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    requested_by_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: User, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
    },
    approved_by_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: User, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    reason_code: { type: DataTypes.STRING(40), allowNull: false },
    authorization_type: { type: DataTypes.STRING(16), allowNull: false },
    discount_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    comp_item_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [{ fields: ["approved_by_id"] }, { fields: ["requested_by_id"] }],
});

export default DiscountAuthorization;
