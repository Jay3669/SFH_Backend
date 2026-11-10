import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import User from "../models/user.model.js";
import { ACCESS_COOKIE_NAME } from "../utils/auth-cookie.js";

let socketServer;

export function attachKitchenSocket(server, allowedOrigins = []) {
    socketServer = new Server(server, {
        cors: {
            origin: allowedOrigins.length ? allowedOrigins : true,
            credentials: true,
        },
    });
    socketServer.use(async (socket, next) => {
        const cookieHeader = socket.handshake.headers.cookie;
        const tokenCookie = typeof cookieHeader === "string"
            ? cookieHeader.split(";").map((part) => part.trim())
                .find((part) => part.startsWith(`${ACCESS_COOKIE_NAME}=`))
            : null;
        let token = socket.handshake.auth?.token;
        if (!token && tokenCookie) {
            try {
                token = decodeURIComponent(tokenCookie.slice(ACCESS_COOKIE_NAME.length + 1));
            } catch {
                return next(new Error("Invalid access cookie."));
            }
        }
        if (typeof token !== "string" || !token) return next(new Error("A staff session is required."));
        const secret = process.env.JWT_ACCESS_SECRET;
        if (!secret) return next(new Error("JWT_ACCESS_SECRET must be set in the environment."));

        try {
            const payload = jwt.verify(token, secret);
            if (typeof payload !== "object" || typeof payload.sub !== "string") {
                return next(new Error("Invalid access token."));
            }
            const user = await User.findByPk(payload.sub);
            if (!user || user.status !== "active" || !["Admin", "Manager", "Employee"].includes(user.role)) {
                return next(new Error("Kitchen access is not available for this account."));
            }
            socket.data.userId = String(user.id);
            return next();
        } catch (error) {
            return next(error);
        }
    });
    socketServer.on("connection", (socket) => socket.join("kitchen"));
    return socketServer;
}

export function emitKitchenEvent(event, payload) {
    if (!socketServer) throw new Error("Kitchen socket server has not been initialized.");
    socketServer.to("kitchen").emit(event, payload);
}
