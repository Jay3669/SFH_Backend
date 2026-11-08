import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";

const PosSettings = sequelize.define("pos_settings", {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    settings: { type: DataTypes.JSONB, allowNull: false },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
});

export default PosSettings;