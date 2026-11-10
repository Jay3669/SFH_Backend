import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import User from "./user.model.js";

const KotOrder = sequelize.define("kot_orders", {
    kot_number: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    fire_key: { type: DataTypes.STRING(120), allowNull: false },
    station: { type: DataTypes.STRING(32), allowNull: false },
    table_name: { type: DataTypes.STRING(64), allowNull: false },
    order_type: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "Dine-in" },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "pending" },
    created_by: {
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
        { unique: true, fields: ["fire_key", "station"] },
        { fields: ["status", "createdAt"] },
    ],
});

export default KotOrder;
