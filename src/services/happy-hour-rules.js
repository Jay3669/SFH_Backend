const WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]);
const TIME_ZONE = "Asia/Kolkata";

function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function zonedParts(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday);
    return { day, minute: Number(values.hour) * 60 + Number(values.minute) };
}

function minutes(value) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(String(value || ""));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function validatePromotion(input) {
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    const categoryId = String(input?.categoryId ?? "");
    const discountPercent = Number(input?.discountPercent);
    const daysOfWeek = input?.daysOfWeek;
    const startTime = String(input?.startTime ?? "");
    const endTime = String(input?.endTime ?? "");
    const start = minutes(startTime);
    const end = minutes(endTime);
    if (!name || name.length > 120) throw Object.assign(new Error("Name is required and must be at most 120 characters."), { status: 400 });
    if (!/^[1-9]\d*$/.test(categoryId)) throw Object.assign(new Error("A valid menu category is required."), { status: 400 });
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
        throw Object.assign(new Error("Discount percentage must be greater than 0 and at most 100."), { status: 400 });
    }
    if (!Array.isArray(daysOfWeek) || !daysOfWeek.length || daysOfWeek.some((day) => (
        !(typeof day === "number" && Number.isInteger(day) && WEEKDAYS.has(day))
        && !(typeof day === "string" && /^[0-6]$/.test(day))
    ))) {
        throw Object.assign(new Error("Select at least one valid weekday (0 for Sunday through 6 for Saturday)."), { status: 400 });
    }
    if (start === null || end === null || start === end) {
        throw Object.assign(new Error("Start and end times must be valid and different."), { status: 400 });
    }
    const effectiveFrom = input.effectiveFrom || null;
    const effectiveUntil = input.effectiveUntil || null;
    if (effectiveFrom && !validDate(effectiveFrom)) throw Object.assign(new Error("effectiveFrom must be a valid YYYY-MM-DD date."), { status: 400 });
    if (effectiveUntil && !validDate(effectiveUntil)) throw Object.assign(new Error("effectiveUntil must be a valid YYYY-MM-DD date."), { status: 400 });
    if (effectiveFrom && effectiveUntil && effectiveFrom > effectiveUntil) throw Object.assign(new Error("effectiveUntil must be on or after effectiveFrom."), { status: 400 });
    if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
        throw Object.assign(new Error("isActive must be a boolean."), { status: 400 });
    }
    return {
        name,
        category_id: categoryId,
        discount_percent: discountPercent,
        days_of_week: [...new Set(daysOfWeek.map(Number))],
        start_time: startTime,
        end_time: endTime,
        effective_from: effectiveFrom,
        effective_until: effectiveUntil,
        is_active: input.isActive !== false,
    };
}

export function isRuleActive(rule, date) {
    const { day, minute } = zonedParts(date);
    const start = minutes(rule.start_time);
    const end = minutes(rule.end_time);
    if (start === null || end === null) return false;
    const days = (Array.isArray(rule.days_of_week) ? rule.days_of_week : []).map(Number);
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
    if (rule.effective_from && dayKey < rule.effective_from) return false;
    if (rule.effective_until && dayKey > rule.effective_until) return false;
    if (start < end) return days.includes(day) && minute >= start && minute < end;
    const previousDay = (day + 6) % 7;
    return days.includes(day) && minute >= start || days.includes(previousDay) && minute < end;
}

export function calculatePromotionDiscountForRules(lines, rules, date = new Date()) {
    const activeRules = rules.filter((rule) => isRuleActive(rule, date));
    const percentByCategory = new Map();
    for (const rule of activeRules) {
        const key = String(rule.category_id);
        percentByCategory.set(key, Math.max(percentByCategory.get(key) || 0, Number(rule.discount_percent)));
    }
    const discountAmount = Math.round(lines.reduce((sum, line) => {
        if (line.isComp) return sum;
        const percent = percentByCategory.get(String(line.menuItem.category_id)) || 0;
        return sum + Number(line.menuItem.price) * line.quantity * percent / 100;
    }, 0) * 100) / 100;
    return { discountAmount, rules: activeRules };
}
