import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";

const AggregatorOrder = sequelize.define("aggregator_orders", {
    aggregator_order_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    provider: { type: DataTypes.STRING(16), allowNull: false },
    external_order_id: { type: DataTypes.STRING(120), allowNull: false },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "new" },
    customer_name: { type: DataTypes.STRING(160), allowNull: true },
    customer_phone: { type: DataTypes.STRING(32), allowNull: true },
    rider_name: { type: DataTypes.STRING(120), allowNull: true },
    total_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    items: { type: DataTypes.JSONB, allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    accepted_at: { type: DataTypes.DATE, allowNull: true },
    fired_at: { type: DataTypes.DATE, allowNull: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
    indexes: [
        { unique: true, fields: ["provider", "external_order_id"] },
        { fields: ["status", "createdAt"] },
    ],
});

export default AggregatorOrder;
