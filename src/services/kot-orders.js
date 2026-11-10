export const KITCHEN_STATIONS = ["Tandoor", "Curry", "Starters", "Beverages"];
export const KOT_STATUSES = ["pending", "cooking", "ready", "served"];
export const KOT_ORDER_TYPES = ["Dine-in", "Takeaway", "Delivery", "swiggy", "zomato"];

export function normalizeKotLines(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
        throw Object.assign(new Error("items must contain between 1 and 100 lines."), { status: 400 });
    }

    return items.map((line) => {
        const menuItemId = String(line?.menuItemId ?? "");
        const quantity = Number(line?.quantity);
        const notes = line?.notes ?? "";
        if (!/^[1-9]\d*$/.test(menuItemId)) {
            throw Object.assign(new Error("Each menuItemId must be a positive integer."), { status: 400 });
        }
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
            throw Object.assign(new Error("Each item quantity must be a positive whole number between 1 and 99."), { status: 400 });
        }
        if (typeof notes !== "string" || notes.length > 300) {
            throw Object.assign(new Error("Item notes must be a string of at most 300 characters."), { status: 400 });
        }
        return { menuItemId, quantity, notes: notes.trim() || null };
    });
}

export function groupKotLinesByStation(lines) {
    const groups = new Map();
    for (const line of lines) {
        const station = line.menuItem.kitchen_station;
        if (!KITCHEN_STATIONS.includes(station)) {
            throw Object.assign(new Error(`Menu item ${line.menuItem.name} has an invalid kitchen station.`), { status: 409 });
        }
        if (!groups.has(station)) groups.set(station, []);
        groups.get(station).push(line);
    }
    return [...groups]
        .sort(([left], [right]) => KITCHEN_STATIONS.indexOf(left) - KITCHEN_STATIONS.indexOf(right))
        .map(([station, stationLines]) => ({ station, lines: stationLines }));
}

export function deriveKotStatus(items) {
    if (!items.length) return "pending";
    const statuses = items.map((item) => item.status);
    if (statuses.every((status) => status === "served")) return "served";
    if (statuses.every((status) => status === "ready" || status === "served")) return "ready";
    if (statuses.some((status) => status !== "pending")) return "cooking";
    return "pending";
}

export function canAdvanceKotStatus(current, next) {
    const currentIndex = KOT_STATUSES.indexOf(current);
    return current === next || currentIndex >= 0 && KOT_STATUSES[currentIndex + 1] === next;
}

export function formatKotNumber(value) {
    return `KOT-${String(value).padStart(6, "0")}`;
}
