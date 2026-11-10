import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import PosSale from "./pos-sale.model.js";
import User from "./user.model.js";

const VoidAudit = sequelize.define("void_audits", {
    void_audit_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    sale_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
        references: { model: PosSale, key: "pos_sale_id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    requested_by_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: User, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    approved_by_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: User, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    },
    reason: { type: DataTypes.STRING(500), allowNull: false },
    previous_status: { type: DataTypes.STRING(24), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
}, {
    schema,
    timestamps: true,
    updatedAt: false,
    freezeTableName: true,
});

export default VoidAudit;
