import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import PosSale from "./pos-sale.model.js";

const WhatsAppDelivery = sequelize.define("whatsapp_bill_deliveries", {
    whatsapp_bill_delivery_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    sale_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
        references: { model: PosSale, key: "pos_sale_id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    phone_number: { type: DataTypes.STRING(20), allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false },
    provider_message_id: { type: DataTypes.STRING(160), allowNull: true },
    error_message: { type: DataTypes.STRING(500), allowNull: true },
    sent_at: { type: DataTypes.DATE, allowNull: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
});

export default WhatsAppDelivery;
