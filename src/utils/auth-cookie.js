export const ACCESS_COOKIE_NAME = "sfh_access_token";

export function getAccessToken(req) {
    const authorization = req.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
        return authorization.slice(7);
    }

    const cookieHeader = req.headers.cookie;
    if (typeof cookieHeader !== "string") return null;
    const cookie = cookieHeader.split(";").map((part) => part.trim())
        .find((part) => part.startsWith(`${ACCESS_COOKIE_NAME}=`));
    if (!cookie) return null;
    try {
        return decodeURIComponent(cookie.slice(ACCESS_COOKIE_NAME.length + 1));
    } catch {
        return null;
    }
}

export function accessCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
    };
}

export function clearAccessCookie(res) {
    res.clearCookie(ACCESS_COOKIE_NAME, accessCookieOptions());
}
