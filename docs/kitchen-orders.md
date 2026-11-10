# Kitchen orders

Menu items have a `kitchen_station` field (`Tandoor`, `Curry`, `Starters`, or
`Beverages`). Existing items default to `Curry`; administrators can change the
station in Menu Management. The server adds this field to an existing
`menu_items` table at startup and creates `kot_orders` and `kot_items` through
Sequelize model synchronization.

## API

All endpoints require an authenticated Admin, Manager, or Employee access
token.

- `POST /api/pos/kots` fires a table order. Send an `Idempotency-Key` header or
  `idempotencyKey` in the body, plus `tableName` and `items` containing
  `menuItemId`, `quantity`, and optional `notes`. The response contains one KOT
  per station represented in the request; each receives a database-generated,
  sequential KOT number.
- `GET /api/pos/kots?station=Tandoor` returns active tickets, optionally
  filtered by station.
- `PATCH /api/pos/kots/:kotNumber/items/:kotItemId` advances one item through
  `pending`, `cooking`, `ready`, and `served`.

The authenticated Socket.IO server publishes `kot:created` and `kot:updated`
events to connected kitchen displays. Clients authenticate the socket
connection with `{ auth: { token: "<access token>" } }`. Served tickets are removed from the active kitchen queue.

## Table management

Firing a KOT creates or occupies the named table. `GET /api/pos/tables`
returns each table with its status (`vacant`, `occupied`, `billed`, or
`dirty/cleaning`) and active KOTs. `POST /api/pos/tables/:tableName/move`
reassigns active KOTs to a vacant `destinationTable`; `POST
/api/pos/tables/:tableName/merge` reassigns them to another occupied table.
Both operations update each KOT transactionally, write the actor, action,
source, destination, and affected KOT numbers to `table_transfers`, and publish
`kot:updated` events so kitchen displays immediately show the new table.

`PATCH /api/pos/tables/:tableName/status` advances a served table from
`occupied` to `billed`, then to `dirty/cleaning`, and finally to `vacant`.
Active KOTs must be served before the table can be billed or cleaned.
