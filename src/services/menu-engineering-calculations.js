const roundCurrency = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateMenuEngineering(dishes) {
    const totalQuantity = dishes.reduce((total, dish) => total + dish.soldQuantity, 0);
    const popularityThresholdPercent = dishes.length && totalQuantity > 0
        ? 70 / dishes.length
        : 0;
    const costedDishes = dishes.filter((dish) => Number.isFinite(dish.ingredientCostPerServing));
    const profitThresholdPerServing = costedDishes.length
        ? costedDishes.reduce((total, dish) => total + dish.grossProfitPerServing, 0) / costedDishes.length
        : null;

    const results = dishes.map((dish) => {
        const popularityPercent = totalQuantity
            ? (dish.soldQuantity / totalQuantity) * 100
            : 0;
        const popularityHigh = popularityPercent >= popularityThresholdPercent;
        const costKnown = Number.isFinite(dish.ingredientCostPerServing);
        const profitabilityHigh = costKnown && dish.grossProfitPerServing >= profitThresholdPerServing;
        let category = "Needs costing";
        if (costKnown) {
            if (popularityHigh && profitabilityHigh) category = "Star";
            else if (popularityHigh) category = "Plowhorse";
            else if (profitabilityHigh) category = "Puzzle";
            else category = "Dog";
        }

        return {
            ...dish,
            popularityPercent: roundCurrency(popularityPercent),
            grossProfitPerServing: costKnown ? roundCurrency(dish.grossProfitPerServing) : null,
            totalGrossProfit: costKnown ? roundCurrency(dish.totalGrossProfit) : null,
            category,
        };
    });

    return {
        dishes: results.sort((left, right) => right.soldQuantity - left.soldQuantity || left.dishName.localeCompare(right.dishName)),
        thresholds: {
            popularityThresholdPercent: roundCurrency(popularityThresholdPercent),
            profitThresholdPerServing: profitThresholdPerServing === null
                ? null
                : roundCurrency(profitThresholdPerServing),
            popularityMethod: "70% of average sold quantity per dish",
            profitabilityMethod: "Average gross profit per serving across costed dishes",
        },
        summary: {
            dishCount: results.length,
            costedDishCount: costedDishes.length,
            missingCostDishCount: results.length - costedDishes.length,
            totalSoldQuantity: totalQuantity,
            categories: ["Star", "Plowhorse", "Puzzle", "Dog", "Needs costing"].reduce((summary, category) => {
                summary[category] = results.filter((dish) => dish.category === category).length;
                return summary;
            }, {}),
        },
    };
}
