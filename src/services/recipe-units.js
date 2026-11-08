const unitAliases = new Map([
    ["kg", ["mass", 1000]], ["kgs", ["mass", 1000]], ["kilogram", ["mass", 1000]], ["kilograms", ["mass", 1000]],
    ["g", ["mass", 1]], ["gm", ["mass", 1]], ["gms", ["mass", 1]], ["grm", ["mass", 1]], ["grms", ["mass", 1]],
    ["gram", ["mass", 1]], ["grams", ["mass", 1]], ["gramme", ["mass", 1]], ["grammes", ["mass", 1]],
    ["mg", ["mass", 0.001]], ["lb", ["mass", 453.59237]], ["lbs", ["mass", 453.59237]],
    ["oz", ["mass", 28.349523125]],
    ["l", ["volume", 1000]], ["lt", ["volume", 1000]], ["ltr", ["volume", 1000]], ["ltrs", ["volume", 1000]],
    ["liter", ["volume", 1000]], ["liters", ["volume", 1000]], ["litre", ["volume", 1000]], ["litres", ["volume", 1000]],
    ["ml", ["volume", 1]], ["milliliter", ["volume", 1]], ["milliliters", ["volume", 1]],
    ["millilitre", ["volume", 1]], ["millilitres", ["volume", 1]], ["cc", ["volume", 1]],
    ["piece", ["count", 1]], ["pieces", ["count", 1]], ["pc", ["count", 1]], ["pcs", ["count", 1]], ["each", ["count", 1]],
    ["dz", ["count", 12]], ["dozen", ["count", 12]],
]);

function normalizedUnit(value) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function unitDescriptor(value) {
    const normalized = normalizedUnit(value);
    return unitAliases.get(normalized) || [`custom:${normalized}`, 1];
}

export function convertQuantity(quantity, fromUnit, toUnit) {
    const [fromDimension, fromFactor] = unitDescriptor(fromUnit);
    const [toDimension, toFactor] = unitDescriptor(toUnit);
    if (fromDimension !== toDimension) {
        throw Object.assign(new Error(`Cannot convert ${fromUnit} to ${toUnit}; the units are incompatible.`), { status: 400 });
    }
    const converted = quantity * fromFactor / toFactor;
    if (!Number.isFinite(converted)) {
        throw Object.assign(new Error("The converted quantity is outside the supported numeric range."), { status: 400 });
    }
    return converted;
}
