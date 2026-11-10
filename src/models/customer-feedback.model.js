import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import PosSale from "./pos-sale.model.js";

const CustomerFeedback = sequelize.define("customer_feedback", {
    customer_feedback_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    sale_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
        references: { model: PosSale, key: "pos_sale_id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    rating: { type: DataTypes.INTEGER, allowNull: false },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
});

export default CustomerFeedback;
