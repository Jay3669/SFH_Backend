# POS cash drawer and shift controls

Active Admin, Manager, and Employee accounts can sign in to the staff portal. After sign-in, the cash drawer screen asks for an opening float when the cashier has no open shift. Cashier shifts are stored in `cash_drawers`; `shift_logs` stores the opening, cash-in/out, closing, and handover audit trail. The authenticated user is recorded as the cashier for each action. Database startup sync creates both tables.

POS sales require the authenticated cashier to have an open cash drawer. Cash sales for a shift are calculated from that cashier's POS tenders between the drawer's `opened_at` and its close time. Cash tender change is subtracted; non-cash tenders do not increase expected drawer cash.

Expected cash is:

`opening_balance + cash tenders (less change) + cash-in movements - cash-out movements`

At close, the cashier submits `actualCash` and optional `cashTaken`. The API persists `expected_cash`, `actual_cash`, and `variance` (`actual_cash - expected_cash`) and closes the shift. A handover closes the current shift using the same blind count, records the recipient, and opens a new shift with the remaining counted cash.

## Endpoints

All endpoints require a bearer access token and an active Admin, Manager, or Employee user.

- `GET /api/pos/cash-drawers` — the authenticated cashier's 30 most recent shifts and movement history.
- `GET /api/pos/cash-drawers/cashiers` — active staff eligible to receive a handover.
- `POST /api/pos/cash-drawers` — open a shift with `{ "businessDate": "YYYY-MM-DD", "openingBalance": 200 }`.
- `POST /api/pos/cash-drawers/:drawerId/movements` — record `{ "direction": "in" | "out", "amount": 20, "description": "Petty cash purchase" }`.
- `POST /api/pos/cash-drawers/:drawerId/close` — close with `{ "actualCash": 310, "cashTaken": 100 }`.
- `POST /api/pos/cash-drawers/:drawerId/handover` — close and transfer to the next shift with `{ "actualCash": 310, "cashTaken": 100, "nextCashierId": "42" }`.

The authenticated user can only modify their own open drawer. A cash-out cannot exceed the computed drawer balance, the close/handover count cannot be negative, and the cash removed cannot exceed the physical count.
