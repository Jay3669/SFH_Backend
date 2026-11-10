# Engagement, ordering, promotions, and kitchen integrations

## WhatsApp e-bills

The cashier's payment dialog records a phone number and explicit consent. A paid sale is sent once through the Meta WhatsApp Cloud API; failed sends are stored and can be retried from the receipt. Partial bills are not sent. Receipt and feedback links expire after 30 days.

Configure these server environment variables:

- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_API_VERSION` (a currently supported Graph API version)
- `META_WHATSAPP_TEMPLATE_NAME`
- `META_WHATSAPP_TEMPLATE_LANGUAGE` (defaults to `en`)
- `PUBLIC_RECEIPT_BASE_URL` (public React app origin)
- `PUBLIC_RECEIPT_API_BASE_URL` (public backend API prefix, for example `https://api.example.com/api`)
- `PUBLIC_RECEIPT_SECRET` (at least 32 characters)

The approved WhatsApp template must contain four body parameters, in order: bill number, total, PDF invoice URL, and feedback URL. Template name, language, and parameter order must match the Meta-approved template. The receipt PDF endpoint is `GET /api/receipts/:token/pdf`; a receipt page and one-to-five-star feedback endpoint use the same signed, time-limited token.

## Table QR ordering

Create a dining table in the POS first, then use **Table QR codes** to generate its customer link. Tokens use authenticated AES-256-GCM encryption and expire according to `PUBLIC_ORDER_TOKEN_DAYS` (default 365, maximum 730). Configure:

- `PUBLIC_ORDER_TOKEN_SECRET` (at least 32 characters)
- `PUBLIC_ORDER_TOKEN_DAYS` (optional)
- `PUBLIC_ORDER_BASE_URL` (public React app origin)

The public customer page displays available menu items and submits KOTs without collecting payment; customers pay at the counter. The server validates current menu availability and never trusts client-supplied prices. Each public order request needs an `Idempotency-Key`.

## Happy hour

Rules are recurring, category-specific percentage discounts scheduled in `Asia/Kolkata`. Effective dates are optional. If active rules overlap for the same category, the highest percentage applies once; category promotions do not stack with each other. Manual POS discounts may apply to the remaining eligible subtotal. The backend recalculates at sale creation and rejects a stale POS estimate so the cashier must refresh before collecting a mismatched amount.

## Swiggy/Zomato adapter

Live provider onboarding, acceptance acknowledgements, and payload mappings require the restaurant's approved partner API/webhook contract. Until supplied, the backend exposes a normalized signed webhook adapter:

- `POST /api/aggregator/webhooks/swiggy`
- `POST /api/aggregator/webhooks/zomato`

Configure `SWIGGY_WEBHOOK_SECRET` and `ZOMATO_WEBHOOK_SECRET`. Requests must provide `x-provider-signature: <hex HMAC-SHA256>` over the exact raw JSON body. The normalized request shape is:

```json
{
  "order_id": "partner-order-id",
  "customer": { "name": "Customer", "phone": "optional" },
  "items": [
    { "menu_item_id": 12, "quantity": 2, "notes": "optional" }
  ],
  "total_amount": 450
}
```

`menu_item_id` values refer to available internal menu rows. Repeated webhook IDs are idempotent. The signed webhook stores orders for the authenticated aggregator dashboard, where staff can accept, fire to KDS, and enter a rider name. The current adapter does not call provider accept/dispatch APIs and does not replace partner-specific menu-ID mapping; wire those only after receiving the provider contracts and credentials.

## Kitchen timing

Every newly served KOT item records its served timestamp. Analytics measure from KOT fire to served, group durations by dish, and flag durations over 25 minutes. Previously served tickets have no reliable item-level completion timestamp and are intentionally excluded rather than assigned a fabricated duration.
