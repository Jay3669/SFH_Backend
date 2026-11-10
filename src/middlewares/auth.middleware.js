import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import { clearAccessCookie, getAccessToken } from "../utils/auth-cookie.js";

export const authenticate = async (req, res, next) => {
    const token = getAccessToken(req);
    if (!token) {
        return res.status(401).json({ success: false, message: "A bearer access token is required." });
    }

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
        return next(new Error("JWT_ACCESS_SECRET must be set in the environment."));
    }

    try {
        const payload = jwt.verify(token, secret);
        if (typeof payload !== "object" || typeof payload.sub !== "string") {
            return res.status(401).json({ success: false, message: "Invalid access token." });
        }

        const user = await User.findByPk(payload.sub, {
            attributes: { exclude: ["password", "manager_pin_hash"] },
        });
        if (!user) return res.status(401).json({ success: false, message: "Invalid access token." });
        if (user.status !== "active") {
            return res.status(403).json({ success: false, message: "This account is inactive." });
        }

        req.user = user;
        return next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
            clearAccessCookie(res);
            return res.status(401).json({ success: false, message: "Invalid or expired access token." });
        }
        return next(error);
    }
};

export const requireAdmin = (req, res, next) => {
    if (req.user?.role !== "Admin") {
        return res.status(403).json({ success: false, message: "Administrator access is required." });
    }
    return next();
};

export const requireRoles = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
        return res.status(403).json({ success: false, message: "You do not have permission to perform this action." });
    }
    return next();
};
