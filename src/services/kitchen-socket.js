import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import User from "../models/user.model.js";

let socketServer;

export function attachKitchenSocket(server, allowedOrigins = []) {
    socketServer = new Server(server, {
        cors: {
            origin: allowedOrigins.length ? allowedOrigins : true,
            credentials: true,
        },
    });
    socketServer.use(async (socket, next) => {
        const token = socket.handshake.auth?.token;
        if (typeof token !== "string" || !token) return next(new Error("A bearer access token is required."));
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
