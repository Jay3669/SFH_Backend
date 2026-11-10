export function buildRecipeRequirements(menuLines, recipes) {
    const recipesByDish = new Map();
    for (const recipe of recipes) {
        if (!recipesByDish.has(recipe.dish_name)) recipesByDish.set(recipe.dish_name, []);
        recipesByDish.get(recipe.dish_name).push(recipe);
    }

    const requirements = new Map();
    const warnings = [];
    for (const line of menuLines) {
        const recipeRows = recipesByDish.get(line.menuItem.name) || [];
        if (!recipeRows.length) {
            warnings.push(`${line.menuItem.name} has no recipe ingredients configured.`);
            continue;
        }
        for (const recipe of recipeRows) {
            const itemId = String(recipe.item_id);
            requirements.set(itemId, (requirements.get(itemId) || 0)
                + Number(recipe.quantity_per_serving) * line.quantity);
        }
    }

    return {
        requirements: [...requirements]
            .map(([itemId, quantity]) => ({ itemId, quantity }))
            .sort((left, right) => Number(left.itemId) - Number(right.itemId)),
        warnings,
    };
}
