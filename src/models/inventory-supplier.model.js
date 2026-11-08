import { DataTypes } from "sequelize";
import { schema, sequelize } from "../config/db.js";

const InventorySupplier = sequelize.define("inventory_suppliers", {
    inventory_supplier_id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(160), allowNull: false, unique: true },
    contact_person: { type: DataTypes.STRING(160), allowNull: false },
    phone: { type: DataTypes.STRING(40), allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: true, validate: { isEmail: true } },
    payment_terms: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "Due on receipt" },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
    schema,
    timestamps: true,
    freezeTableName: true,
});

export default InventorySupplier;
