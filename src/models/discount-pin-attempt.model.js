import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";
import User from "./user.model.js";

const DiscountPinAttempt = sequelize.define("discount_pin_attempts", {
    user_id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        references: { model: User, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    failed_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    window_started_at: { type: DataTypes.DATE, allowNull: true },
    locked_until: { type: DataTypes.DATE, allowNull: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
});

export default DiscountPinAttempt;
