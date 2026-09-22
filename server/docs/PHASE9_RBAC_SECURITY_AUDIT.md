# Phase 9 — RBAC / Security Audit (Phases 3–7 features)

Scope: every new route and service added in this batch — promotions engine
(Phase 3), scheduled base pricing (Phase 4), variant purchasing/goods
receiving (Phase 5), variant batches/FEFO/returns/write-offs (Phase 6), and
variant back-in-stock subscriptions (Phase 7). Checked against: IDOR, mass
assignment, race conditions, negative inventory, over-receiving, duplicate
promotion application, and duplicate scheduled-price execution.

## Result: no new vulnerabilities found; existing protections confirmed

Every new route follows the patterns already established elsewhere in the
codebase (whitelisted input parsing, `requirePermission`/`requireAdmin`
guards, `FOR UPDATE` row locking inside a single transaction for any
check-then-write sequence). No new RBAC permissions were created — every new
route reuses an existing permission string, as the batch spec required:

| Feature | Permission reused |
|---|---|
| Promotions (admin CRUD) | `discounts.manage` |
| Scheduled pricing (admin CRUD) | `products.pricing.bulk_update` |
| Purchase orders | `purchases.view` / `purchases.create` |
| Goods receiving | `purchases.view` / `purchases.receive` |
| Stock write-offs (incl. variant) | `inventory.adjust` |
| Customer/supplier returns (incl. variant) | `returns.manage` |
| Back-in-stock subscribe/unsubscribe | `requireAuth` only (self-scoped to `req.user.id`, no admin permission needed — matches the existing pattern for other self-service customer routes) |

### IDOR

- **Variant ownership claims** (a request claiming `{productId, variantId}`)
  are validated server-side everywhere a variant can be attached to a new
  row: `purchaseOrderService.validateVariantOwnership`,
  `goodsReceivingService`'s per-item check, `supplierReturnService`'s new
  variant-mismatch check (Phase 6), and `customerReturnService`'s check that
  the claimed `variantId` matches the original `order_items.variant_id`
  exactly (Phase 6). A caller cannot attach an arbitrary variant to a
  different product's line item.
- **Back-in-stock subscriptions** are always scoped to `req.user!.id` from
  the authenticated session — never taken from the request body — so a user
  can only read/create/delete their own subscription rows.
- **Admin resources** (promotions, price schedules, purchase orders, goods
  receipts, returns) have no per-owner scoping requirement (they are
  store-wide admin resources gated by permission, not per-user data), so
  IDOR in the "user A reads user B's private data" sense does not apply —
  the relevant control is the permission check, which is present everywhere.

### Mass assignment

Every POST/PATCH body is parsed through an explicit field-by-field
`parseInput`/`validateBody` function that whitelists exactly the expected
keys and types (promotions, price schedules, purchase orders, goods receipts,
supplier/customer returns, write-offs, back-in-stock). None of the new routes
spread `req.body` directly into a query or pass it through unchecked.

### Race conditions / negative inventory / over-receiving

Every stock-decrementing path takes the affected row (or rows) with
`SELECT ... FOR UPDATE` inside the same transaction as the read-check-write,
so two concurrent requests against the same product/variant/PO serialize
rather than race:

- `deductVariantStock` / `deductStockForOrder`: the `stock >= quantity`
  condition lives inside the same `UPDATE` statement as the decrement (belt
  and suspenders beyond the row lock).
- `writeOffStockWithClient` (variant branch, added in Phase 6): locks the
  variant row, checks `stock >= quantity` before decrementing, mirrors the
  base-product branch exactly.
- `goodsReceivingService.receiveGoodsForPurchaseOrder`: locks the purchase
  order and every `purchase_order_items` row up front; the
  `item.quantity > remaining` (ordered − already received) check happens
  against those locked rows, so a second concurrent receipt against the same
  PO cannot over-receive past what was actually ordered.
- `supplierReturnService.updateSupplierReturnStatus`: locks the return row
  before checking/transitioning status, so a double-submit cannot write off
  stock twice for the same return.

### Duplicate promotion application

`computeBuyXGetY`/`computeBundle` enforce `maxApplicationsPerOrder` (already
tested in Phase 3). Promotion computation happens once, inside
`orderService.createOrder`'s single transaction per order — there is no
externally-triggerable "recompute promotions for an existing order" endpoint,
so there is no path to apply a promotion twice to the same order.

### Duplicate scheduled-price execution

`runApplyScheduledBatch` (Phase 4) already has the strongest form of this
protection: it only selects rows `WHERE status = 'pending'`, takes them with
`FOR UPDATE SKIP LOCKED` (so two concurrent cron runs split the work instead
of double-processing the same row), and flips the row to `'applied'` in the
same transaction as the price update and history insert. A schedule can only
ever be applied once — confirmed by the existing `pricingScheduleService`
test suite and re-verified in this audit by inspection.

## Conclusion

No code changes were required as a result of this audit — every checklist
item was already satisfied by the patterns each phase followed. This
document exists as the record that the check was actually performed against
Phases 3–7's routes and services, per the spec's Phase 9 requirement.
