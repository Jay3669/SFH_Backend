# POS billing and payments

POS sales are available to Admin, Manager, and Employee roles.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/pos/sales` | Record a sale and its payment rows |
| `GET` | `/api/pos/sales` | List recent sales |
| `POST` | `/api/pos/sales/:saleId/void` | Void a bill with a reason and active supervisor PIN |
| `POST` | `/api/pos/discount-authorizations/pin` | Set the signed-in Admin or Manager's approval PIN |

Sale requests provide the bill items, payment method, and one or more tenders:

```json
{
  "idempotencyKey": "cashier-session-sale-42",
  "items": [{ "menuItemId": "12", "quantity": 2, "notes": "Less spicy" }],
  "paymentMethod": "Split",
  "tenders": [
    { "method": "Cash", "amount": 500 },
    { "method": "UPI", "amount": 750, "transactionRef": "UPI-456" }
  ]
}
```

Tenders support `Cash`, `Card`, and `UPI`. A split sale requires at least two positive tender rows; the same method may appear on multiple rows. Each optional `transactionRef` is limited to 120 characters. Amounts must use at most two decimal places. The server validates enabled payment methods, bill totals, and cash change.
Menu prices are always read from the database; submitted unit prices are ignored. Each line is limited to 99 units. Indian mobile numbers are normalized to `+91` and must have a valid 10-digit mobile prefix.
Each item may include an optional preparation `notes` string of up to 300 characters. Notes are saved with the sale item and returned in bill/report details. Apply the schema update on existing installations with `npm run migrate:pos-sale-item-notes` before deploying the updated API.

The cashier UI can distribute a bill equally among 2–20 people or assign bill lines to individual payers. Both modes are submitted as ordinary tender rows, with any per-payer methods and transaction references. Item shares allocate the final bill amount proportionally across lines, including discounts, packaging, and tax.

Discounts above 10% of the subtotal and any comp/NC item require an active Admin or Manager's 4-digit PIN and a reason code (`service_recovery`, `promotion`, `pricing_error`, `customer_retention`, or `other`). The server validates the approver; it does not trust a client-supplied approver ID or role. Managers enroll or change their PIN from the cashier page after confirming their account password; the setup endpoint accepts `currentPassword`, `pin`, and `confirmPin`. PINs are bcrypt-hashed, and five failed attempts from the same cashier account lock PIN verification for 15 minutes. A comp applies to the whole selected cart line and is included in the audited discount total.

Approvals are stored in `discount_authorizations` with the sale/order ID, cashier, approving manager, reason, total discount, authorization type, and comp item IDs. Comp lines are flagged on `pos_sale_items` and shown as NC on the receipt. Discount and comp amounts are deducted from the subtotal before tax; paid comp items still follow the normal recipe stock-deduction flow.

GST is calculated once from the taxable subtotal after discounts and packaging, then rounded half up to the nearest whole rupee. The backend is authoritative for the stored tax and total. Voiding a bill requires an active Admin/Manager PIN and a reason; the sale remains stored with status `Voided`, while the approver, requester, prior status, amount, and reason are recorded atomically in `void_audits`. Voids are excluded from sales totals but remain visible in reports. This records the cancellation; any cash refund must still be handled and reconciled through the cash drawer.
The billing report displays the void audit and lets authorized staff submit a reason and supervisor PIN. Table-order drafts for registered tables are saved in the browser by table ID after a 1.5-second debounce and restored when that table is selected; they are cleared after successful KOT submission.

Payment rows are stored in `order_payments` with `order_id`, `payment_mode`, `transaction_ref`, and `amount`. Existing `pos_sale_tenders` rows are also written for compatibility with older billing reports; historical sales without `order_payments` continue to serialize from that legacy table.

## Recipe stock consumption

Fully paid POS sales enqueue a durable inventory-deduction job in the same transaction as the bill. A background worker consumes each menu item's configured per-serving recipe ingredients using FIFO inventory batches and records a `POS consumption` row in the daily inventory movement ledger. The worker does not block checkout, and the unique sale reference prevents a retried job from deducting stock twice.

Partially paid bills remain in `awaiting_payment` and do not consume ingredients. A paid sale exposes `stockDeductionStatus` (`pending` or `completed`) and any `stockWarnings` through the sale API. Temporary stock or database errors are logged and retried with backoff; failed attempts do not partially change stock. Missing recipes are reported as warnings. When consumption brings an ingredient to or below its reorder level, the warning is recorded and the updated stock appears in the inventory low-stock alerts.

## Business-day reporting

Daily sales reports use the restaurant's Asia/Kolkata business day, from 06:00 IST through 02:00 IST the following calendar day. Orders before 06:00 are assigned to the prior business date; the 02:00–06:00 interval is outside the configured reporting window. Weekly and monthly reports apply those same boundaries to their first and final business dates.
