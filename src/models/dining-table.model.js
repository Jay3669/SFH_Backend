import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";

const DiningTable = sequelize.define("dining_tables", {
    dining_table_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    table_name: { type: DataTypes.STRING(64), allowNull: false, unique: "dining_table_name" },
    status: {
        type: DataTypes.ENUM("vacant", "occupied", "billed", "dirty/cleaning"),
        allowNull: false,
        defaultValue: "vacant",
    },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
});

export default DiningTable;
