import User from "../models/user.model.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { sequelize } from "../config/db.js";
import { ACCESS_COOKIE_NAME, accessCookieOptions, clearAccessCookie } from "../utils/auth-cookie.js";

const selfRegistrationRoles = new Set(["Employee", "Customer"]);

function readBoolean(value, fieldName) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw Object.assign(new Error(`${fieldName} must be a boolean.`), { status: 400 });
}

function publicUser(user) {
    const data = user.toJSON();
    delete data.password;
    delete data.manager_pin_hash;
    return data;
}

function authenticatedUser(user) {
    return {
        id: String(user.id),
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone_number: user.phone_number,
        status: user.status,
        role: user.role,
        user_pic: user.user_pic ?? null,
        is_subscribed: user.is_subscribed,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}

export const register = async (req, res, next) => {
    try {
        const body = req.body ?? {};
        const {
            first_name,
            last_name,
            phone_number,
            email,
            password,
            role,
            status,
        } = body;

        if (typeof first_name !== "string" || !first_name.trim()) {
            return res.status(400).json({ message: "first_name is required." });
        }
        if (typeof email !== "string" || !email.trim()) {
            return res.status(400).json({ message: "A valid email is required." });
        }
        if (typeof password !== "string" || password.length < 8) {
            return res.status(400).json({ message: "password must be at least 8 characters." });
        }
        if (role !== undefined && !selfRegistrationRoles.has(role)) {
            return res.status(400).json({ message: "Public registration only supports Employee or Customer roles." });
        }
        if (status !== undefined && status !== "inactive") {
            return res.status(400).json({ message: "New accounts must be inactive until approved." });
        }

        const verificationValue = body.is_verified ?? body.is_verfied;
        if (verificationValue !== undefined && readBoolean(verificationValue, "is_verfied")) {
            return res.status(400).json({ message: "New accounts cannot be marked verified during registration." });
        }

        const subscriptionValue = body.is_subscribed ?? body.is_subscribe;
        const user = await User.create({
            first_name: first_name.trim(),
            last_name: typeof last_name === "string" && last_name.trim() ? last_name.trim() : null,
            phone_number: typeof phone_number === "string" && phone_number.trim()
                ? phone_number.trim()
                : null,
            email: email.trim().toLowerCase(),
            password: await bcrypt.hash(password, 12),
            role: role || "Employee",
            status: "inactive",
            is_verified: false,
            is_subscribed: subscriptionValue === undefined
                ? false
                : readBoolean(subscriptionValue, "is_subscribe"),
        });

        return res.status(201).json({
            message: "Registration successful. Your account is pending activation.",
            user: publicUser(user),
        });
    } catch (error) {
        return next(error);
    }
};

export const login = async (req, res, next) => {
    try {
        const { identifier, email, password } = req.body ?? {};
        if (identifier !== undefined && email !== undefined) {
            return res.status(400).json({ message: "Provide either identifier or email, not both." });
        }

        const loginIdentifier = identifier ?? email;
        if (typeof loginIdentifier !== "string" || !loginIdentifier.trim()) {
            return res.status(400).json({ message: "identifier is required and must be an email address or phone number." });
        }
        if (typeof password !== "string" || !password) {
            return res.status(400).json({ message: "password is required." });
        }

        const normalizedIdentifier = loginIdentifier.trim();
        const isEmail = normalizedIdentifier.includes("@");
        if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedIdentifier)) {
            return res.status(400).json({ message: "Enter a valid email address." });
        }
        if (!isEmail && !/^\+?[\d\s().-]+$/.test(normalizedIdentifier.replace(/\s/g, ""))) {
            return res.status(400).json({ message: "Enter a valid phone number or email address." });
        }
        const phoneDigits = normalizedIdentifier.replace(/\D/g, "");
        if (!isEmail && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
            return res.status(400).json({ message: "Enter a valid phone number containing 7 to 15 digits." });
        }

        const where = isEmail
            ? { email: normalizedIdentifier.toLowerCase() }
            : sequelize.where(
                sequelize.fn(
                    "regexp_replace",
                    sequelize.col("phone_number"),
                    "[^0-9]",
                    "",
                    "g",
                ),
                phoneDigits,
            );
        const user = await User.findOne({
            where,
        });
        if (!user) {
            return res.status(401).json({
                message: isEmail
                    ? "No account found with this email address."
                    : "No account found with this phone number.",
            });
        }
        if (!(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "Incorrect password." });
        }
        if (user.status !== "active") {
            return res.status(403).json({ message: "This account is inactive." });
        }

        const secret = process.env.JWT_ACCESS_SECRET;
        if (!secret) {
            throw new Error("JWT_ACCESS_SECRET must be set in the environment.");
        }

        const accessToken = jwt.sign(
            { sub: String(user.id), role: user.role },
            secret,
            { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "8h" },
        );
        res.cookie(ACCESS_COOKIE_NAME, accessToken, accessCookieOptions());

        return res.json({
            success: true,
            message: "Authentication successful. Welcome back!",
            data: authenticatedUser(user),
        });
    } catch (error) {
        return next(error);
    }
};

export const logout = (req, res) => {
    clearAccessCookie(res);
    return res.json({ success: true, message: "Signed out." });
};

export const forgotPassword = async (req, res, next) => {
    try {
        const email = typeof req.body?.email === "string"
            ? req.body.email.trim().toLowerCase()
            : "";
        const message = "If an account exists for this email, password reset instructions have been sent.";
        if (!email) {
            return res.status(400).json({ success: false, message: "email is required." });
        }

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.json({ success: true, message });
        }

        const secret = process.env.JWT_PASSWORD_RESET_SECRET || process.env.JWT_ACCESS_SECRET;
        if (!secret) {
            throw new Error("JWT_PASSWORD_RESET_SECRET or JWT_ACCESS_SECRET must be set in the environment.");
        }
        const token = jwt.sign(
            { sub: String(user.id), purpose: "password-reset" },
            secret,
            { expiresIn: process.env.PASSWORD_RESET_EXPIRES_IN || "30m" },
        );

        return res.json({
            success: true,
            message,
            ...(process.env.NODE_ENV !== "production" ? { resetToken: token } : {}),
        });
    } catch (error) {
        return next(error);
    }
};

export const resetPassword = async (req, res, next) => {
    try {
        const password = req.body?.password;
        if (typeof password !== "string" || password.length < 8) {
            return res.status(400).json({ success: false, message: "password must be at least 8 characters." });
        }

        const secret = process.env.JWT_PASSWORD_RESET_SECRET || process.env.JWT_ACCESS_SECRET;
        if (!secret) {
            throw new Error("JWT_PASSWORD_RESET_SECRET or JWT_ACCESS_SECRET must be set in the environment.");
        }

        let claims;
        try {
            claims = jwt.verify(req.params.token, secret);
        } catch {
            return res.status(400).json({ success: false, message: "The password reset link is invalid or has expired." });
        }
        if (claims.purpose !== "password-reset" || !claims.sub) {
            return res.status(400).json({ success: false, message: "The password reset link is invalid." });
        }

        const user = await User.findByPk(claims.sub);
        if (!user) {
            return res.status(400).json({ success: false, message: "The password reset link is invalid." });
        }

        user.password = await bcrypt.hash(password, 12);
        await user.save();
        return res.json({ success: true, message: "Password reset successfully." });
    } catch (error) {
        return next(error);
    }
};