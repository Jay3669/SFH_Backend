# Recipe production API

All routes require a bearer access token and an `Admin` or `Manager` role. Quantities use at most three decimal places. Unit conversion is automatic for mass (`kg`, `g`, `mg`, `lb`, `oz`), volume (`l`/`litre`, `ml`), and count (`piece`/`pcs`); custom units convert only to the same normalized unit. Incompatible dimensions are rejected.

## Recipes

`GET /api/inventory/recipe-items` supplies the inventory items available for recipe configuration to both roles.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/recipes` | List recipes, current versions, and ingredients |
| `POST` | `/api/recipes` | Create a recipe and its initial version |
| `GET` | `/api/recipes/:id` | Get a recipe and its current version |
| `GET` | `/api/recipes/:id/versions` | List all immutable versions and their cost snapshots |
| `GET` | `/api/recipes/:id/versions/:versionNumber` | Get one historical version |
| `PUT` | `/api/recipes/:id` | Create a new immutable version |
| `DELETE` | `/api/recipes/:id` | Deactivate a recipe without deleting history |
| `GET` | `/api/recipes/:recipeId/ingredients` | List ingredients in the current version |
| `POST` | `/api/recipes/:recipeId/ingredients` | Add an ingredient by creating a new version |
| `PUT` | `/api/recipes/:recipeId/ingredients/:ingredientId` | Update an ingredient in a new version |
| `DELETE` | `/api/recipes/:recipeId/ingredients/:ingredientId` | Remove an ingredient in a new version |

Recipe create/update body:

```json
{
  "menuItemId": "12",
  "name": "Chicken Fry Biryani",
  "baseProductionQuantity": 1,
  "productionUnit": "kg",
  "instructions": "Cook rice and chicken separately, then layer.",
  "status": "Active",
  "ingredients": [
    { "itemId": "4", "quantity": 1, "unit": "kg" },
    { "itemId": "8", "quantity": 500, "unit": "g" },
    { "itemId": "9", "quantity": 200, "unit": "ml" }
  ]
}
```

Ingredient mutations accept `itemId`, `quantity`, and `unit`. At least one ingredient is required. Recipe edits preserve older recipe versions and their ingredient-cost snapshots.

## Production

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/productions/preview` | Calculate scaled ingredient quantities, stock, and estimated costs without writes |
| `POST` | `/api/productions` | Create a draft; optional `Idempotency-Key` header makes retries safe |
| `GET` | `/api/productions` | List productions; optional `status`, `from`, and `to` query filters |
| `GET` | `/api/productions/:id` | Get a production entry and confirmed cost snapshots |
| `POST` | `/api/productions/:id/confirm` | Atomically check and deduct stock using FIFO batches |
| `POST` | `/api/productions/:id/cancel` | Cancel a draft or restore confirmed stock to its original batches |

Preview and draft body:

```json
{ "recipeId": "3", "quantity": 5, "unit": "kg", "productionDate": "2026-11-07" }
```

Confirmation is safe to retry: a confirmed entry is returned without deducting stock again. Insufficient stock rejects the entire transaction. Cancellation retains movements and records a reversal rather than deleting history.

## Consumption reports

- `GET /api/inventory/consumption/daily?date=YYYY-MM-DD`
- `GET /api/inventory/consumption/weekly?date=YYYY-MM-DD` (or `from` and `to`)
- `GET /api/inventory/consumption/monthly?month=YYYY-MM`
- `GET /api/inventory/consumption/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`

Optional report filters: `recipeId`, `itemId`, and `status`. The summary defaults to the latest 30 days. Reports include production entries, production quantities grouped by unit, ingredient consumption and historical costs, received purchase spend, current inventory valuation, current stock, and low-stock items.

## Preparation planning

`POST /api/inventory/preparation-plan` stores a plan without deducting stock:

```json
{
  "date": "2026-11-07",
  "productions": [
    { "recipeId": "3", "quantity": 5, "unit": "kg" }
  ]
}
```

- `GET /api/inventory/next-day-requirements?date=YYYY-MM-DD`
- `GET /api/inventory/shortages?date=YYYY-MM-DD`
- `GET /api/inventory/purchase-suggestions?date=YYYY-MM-DD`

Planning reads may specify `planId` instead of `date`. The endpoints use the latest saved plan for the selected date and return aggregated ingredient requirements, shortages, and estimated purchase cost.

## Persistence

The backend currently creates model tables with `sequelize.sync()` during startup; this repository does not have a migration runner. The recipe and production tables are registered through the recipe workflow routes and are created automatically when the server starts against its configured schema.
