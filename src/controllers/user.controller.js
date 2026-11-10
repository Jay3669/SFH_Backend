import bcrypt from "bcrypt";
import User from "../models/user.model.js";

const fieldAliases = {
    is_verfied: "is_verified",
    is_subscribe: "is_subscribed",
};
const editableFields = new Set([
    "first_name",
    "last_name",
    "phone_number",
    "email",
    "password",
    "role",
    "status",
    "is_verified",
    "is_verfied",
    "is_subscribed",
    "is_subscribe",
]);
const roles = new Set(["Admin", "Manager", "Employee", "Customer"]);
const statuses = new Set(["active", "inactive"]);
const creatableRoles = new Set(["Manager", "Employee"]);
const creatableFields = new Set([
    "first_name",
    "last_name",
    "phone_number",
    "email",
    "password",
    "role",
]);

function readBoolean(value, fieldName) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw Object.assign(new Error(`${fieldName} must be a boolean.`), { status: 400 });
}

function validateId(id) {
    if (!/^[1-9]\d*$/.test(id)) {
        return false;
    }
    return true;
}

function publicUser(user) {
    const data = user.toJSON();
    delete data.password;
    delete data.manager_pin_hash;
    return data;
}

function parsePage(value, fallback) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw Object.assign(new Error("page and limit must be positive integers."), { status: 400 });
    }
    return parsed;
}

export const getUsers = async (req, res, next) => {
    try {
        const page = parsePage(req.query.page, 1);
        const limit = parsePage(req.query.limit, 20);
        if (limit > 100) {
            return res.status(400).json({ message: "limit cannot exceed 100." });
        }

        const { count, rows } = await User.findAndCountAll({
            attributes: { exclude: ["password", "manager_pin_hash"] },
            order: [["id", "ASC"]],
            limit,
            offset: (page - 1) * limit,
        });
        return res.json({
            users: rows,
            pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
        });
    } catch (error) {
        return next(error);
    }
};

export const createUser = async (req, res, next) => {
    try {
        const body = req.body ?? {};
        const unknownFields = Object.keys(body).filter((field) => !creatableFields.has(field));
        if (unknownFields.length) {
            return res.status(400).json({ message: `Unsupported fields: ${unknownFields.join(", ")}.` });
        }

        const { first_name, last_name, phone_number, email, password, role } = body;
        if (typeof first_name !== "string" || !first_name.trim()) {
            return res.status(400).json({ message: "first_name is required." });
        }
        if (typeof email !== "string" || !email.trim()) {
            return res.status(400).json({ message: "A valid email is required." });
        }
        if (typeof password !== "string" || password.length < 8) {
            return res.status(400).json({ message: "password must be at least 8 characters." });
        }
        if (!creatableRoles.has(role)) {
            return res.status(400).json({ message: "role must be Manager or Employee." });
        }
        if (last_name !== undefined && last_name !== null && typeof last_name !== "string") {
            return res.status(400).json({ message: "last_name must be a string or null." });
        }
        if (phone_number !== undefined && phone_number !== null && typeof phone_number !== "string") {
            return res.status(400).json({ message: "phone_number must be a string or null." });
        }

        const user = await User.create({
            first_name: first_name.trim(),
            last_name: typeof last_name === "string" && last_name.trim() ? last_name.trim() : null,
            phone_number: typeof phone_number === "string" && phone_number.trim()
                ? phone_number.trim()
                : null,
            email: email.trim().toLowerCase(),
            password: await bcrypt.hash(password, 12),
            role,
            status: "active",
            is_verified: false,
            is_subscribed: false,
        });

        return res.status(201).json({
            message: `${role} account created successfully.`,
            user: publicUser(user),
        });
    } catch (error) {
        return next(error);
    }
};

export const getUserById = async (req, res, next) => {
    try {
        if (!validateId(req.params.id)) {
            return res.status(400).json({ message: "id must be a positive integer." });
        }
        const user = await User.findByPk(req.params.id, {
            attributes: { exclude: ["password", "manager_pin_hash"] },
        });
        if (!user) return res.status(404).json({ message: "User not found." });
        return res.json({ user });
    } catch (error) {
        return next(error);
    }
};

export const updateUser = async (req, res, next) => {
    try {
        const body = req.body ?? {};
        if (!validateId(req.params.id)) {
            return res.status(400).json({ message: "id must be a positive integer." });
        }
        const unknownFields = Object.keys(body).filter((field) => !editableFields.has(field));
        if (unknownFields.length) {
            return res.status(400).json({ message: `Unsupported fields: ${unknownFields.join(", ")}.` });
        }
        if (!Object.keys(body).length) {
            return res.status(400).json({ message: "At least one field is required." });
        }

        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found." });

        const updates = {};
        for (const [inputField, value] of Object.entries(body)) {
            const field = fieldAliases[inputField] || inputField;
            if (inputField === "password") {
                if (typeof value !== "string" || value.length < 8) {
                    return res.status(400).json({ message: "password must be at least 8 characters." });
                }
                updates.password = await bcrypt.hash(value, 12);
            } else if (field === "email") {
                if (typeof value !== "string" || !value.trim()) {
                    return res.status(400).json({ message: "email must be a valid email address." });
                }
                updates.email = value.trim().toLowerCase();
            } else if (field === "first_name") {
                if (typeof value !== "string" || !value.trim()) {
                    return res.status(400).json({ message: "first_name cannot be empty." });
                }
                updates.first_name = value.trim();
            } else if (field === "last_name" || field === "phone_number") {
                if (value !== null && typeof value !== "string") {
                    return res.status(400).json({ message: `${field} must be a string or null.` });
                }
                updates[field] = typeof value === "string" && value.trim() ? value.trim() : null;
            } else if (field === "role") {
                if (!roles.has(value)) {
                    return res.status(400).json({ message: "role is invalid." });
                }
                updates.role = value;
            } else if (field === "status") {
                if (!statuses.has(value)) {
                    return res.status(400).json({ message: "status is invalid." });
                }
                updates.status = value;
            } else {
                updates[field] = readBoolean(value, inputField);
            }
        }

        await user.update(updates);
        return res.json({ message: "User updated successfully.", user: publicUser(user) });
    } catch (error) {
        return next(error);
    }
};

export const deleteUser = async (req, res, next) => {
    try {
        if (!validateId(req.params.id)) {
            return res.status(400).json({ message: "id must be a positive integer." });
        }
        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found." });

        await user.destroy();
        return res.status(204).end();
    } catch (error) {
        return next(error);
    }
};
