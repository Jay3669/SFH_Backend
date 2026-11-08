import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";

const User = sequelize.define(
    "users",
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },

        first_name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        last_name: {
            type: DataTypes.STRING,
            allowNull: true,
        },

        email: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            validate: {
                isEmail: true,
            },
        },

        password: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        phone_number: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
        },

        role: {
            type: DataTypes.ENUM("Admin", "Manager", "Employee", "Customer"),
            defaultValue: "Employee",
        },

        status: {
            type: DataTypes.ENUM("active", "inactive"),
            defaultValue: "inactive", // Set to inactive by default for new registrations
        },

        is_verified: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },

        is_subscribed: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
    },
    {
        schema,
        timestamps: true,
        freezeTableName: true,
    }
);

export default User;