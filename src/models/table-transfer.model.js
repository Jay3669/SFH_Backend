import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import User from "./user.model.js";

const TableTransfer = sequelize.define("table_transfers", {
    table_transfer_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    action: { type: DataTypes.ENUM("move", "merge"), allowNull: false },
    source_table: { type: DataTypes.STRING(64), allowNull: false },
    destination_table: { type: DataTypes.STRING(64), allowNull: false },
    kot_numbers: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    performed_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: User, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
    },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [
        { fields: ["source_table", "createdAt"] },
        { fields: ["destination_table", "createdAt"] },
    ],
});

export default TableTransfer;
