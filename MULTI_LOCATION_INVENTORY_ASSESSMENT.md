# Multi-Location Inventory — Assessment (FUTURE SCALE FEATURE)

**Status: NOT IMPLEMENTED.** This document is a design/impact assessment only,
produced as Phase 8 of the variant-purchasing/FEFO batch. It exists so that if
the business later needs a second physical location (a second store, a
warehouse, a dark store), there is an honest starting point for that work —
not a promise that any of this exists today.

## 1. Why this is not being built now

Every part of the system currently assumes **exactly one physical stock
location**. That assumption is not an oversight — it is the correct
simplification for a single-store operation, and it keeps every stock
calculation (sellable stock, FEFO consumption, reorder points, valuation,
picking) a single-number, single-row operation. Building real multi-location
support now, with no second location actually operating, would mean:

- Guessing at requirements no real location has validated yet (transfer
  approval flow, inter-location transit accounting, which reports need a
  location filter vs. a company-wide rollup).
- Doubling the surface area of every inventory write path (deduct, restore,
  write-off, receive, count, transfer) for a scenario that cannot be tested
  against real operational behavior.
- Carrying that complexity — extra joins, extra nullable-vs-required
  location columns, extra admin UI — as dead weight in the single-location
  case, which is the only case that exists today.

The recommendation is to revisit this **only when a second location is
concretely being opened**, not speculatively.

## 2. What "single location" is currently baked into

Grep-level inventory of where the single-location assumption lives today:

| Area | Current shape | Assumption |
|---|---|---|
| `products.stock`, `product_variants.stock` | one integer column | one location |
| `inventory_batches` | `product_id` (+ `variant_id`), no location column | all batches are "the" warehouse |
| `stock_movements` | no location column | every movement is against the single stock pool |
| `purchase_orders` / `goods_receipts` | no destination location | everything received goes to the one stock pool |
| `back_in_stock_subscriptions` | scoped to product/variant only | "in stock" means in-stock anywhere (i.e. the one place) |
| Delivery zones/slots, rider assignment | one dispatch origin implied | orders ship from a single place |
| Replenishment engine, reorder points, valuation, cycle counts | single running total per product/variant | no location dimension to aggregate over |
| Admin UI (`InventoryPage`, `StockMovesPage`, `ExpiryDashboardPage`, purchasing pages) | no location selector anywhere | nothing to select |

This is consistent everywhere — there is no partial multi-location support to
extend; it would be new plumbing from the schema up.

## 3. What multi-location support would actually require

### 3.1 Schema (additive, following the project's migration discipline)

- New `locations` table (`id`, `name`, `type` — e.g. `store` / `warehouse` /
  `dark_store` — `active`, `is_default`).
- A `location_id` column (nullable at first, backfilled to the single existing
  default location, then made required going forward) added to every
  stock-bearing table: a new `product_stock` / `product_variant_stock` table
  replacing the single `stock` integer (or an additive per-location stock
  table alongside the legacy column, with `products.stock` becoming a
  computed/cached sum for backward compatibility), `inventory_batches`,
  `stock_movements`, `purchase_orders`, `goods_receipts`.
- New `stock_transfers` / `stock_transfer_items` tables for moving inventory
  between locations, with its own status lifecycle (`draft` → `approved` →
  `in_transit` → `received` → `cancelled`), mirroring the existing purchase
  order / goods receiving state-machine pattern already used in this codebase.
- `back_in_stock_subscriptions` would need a location dimension only if
  storefront browsing itself becomes location-aware (see 3.3).

### 3.2 Service-layer changes

- Every function in `inventoryService.ts`, `inventoryBatchService.ts`,
  `productVariantService.ts`, `stockWriteOffService.ts`,
  `customerReturnService.ts`, `supplierReturnService.ts`, and
  `replenishmentService.ts` that reads or writes stock would need a
  `locationId` parameter threaded through — FEFO consumption, sellable-stock
  calculation, and lock-for-order all become **per-location**, not global.
- Order fulfillment would need a location assignment step: which location
  fulfills a given order (fixed, if there's one warehouse per delivery zone;
  or chosen at checkout/picking time if locations overlap in coverage).
- A new transfer service for moving stock between locations, including its
  own FEFO-aware consumption at the source location and batch creation at the
  destination (batches don't teleport — a transfer effectively re-receives
  the transferred quantity as a new batch at the destination, or the batch
  lineage must be extended to record which location currently holds it).

### 3.3 Storefront implications

- If the storefront ever needs to show "in stock at your nearest branch"
  rather than a single company-wide number, product/catalog pages need a
  location context (from the customer's delivery address or an explicit
  branch selector), and "sellable stock" becomes location-scoped everywhere
  it's shown to a customer.
- If instead every location simply feeds one shared online catalog (common
  for a warehouse + retail-store setup where the storefront always ships from
  the warehouse and the retail store is a separate walk-in-only stock pool), the
  storefront itself may need **no changes at all** — only the admin/ops side
  would become location-aware. This is the cheaper, more likely-correct
  design for most single-brand small-chain setups and should be the default
  assumption if/when this is built.

### 3.4 Admin UI implications

- A location switcher/filter across: inventory list, stock moves, expiry
  dashboard, purchasing (POs would need a destination location), goods
  receiving, cycle counts, valuation, and replenishment recommendations.
- A new "Transfers" section (list, create, approve, receive) mirroring the
  existing Supplier Returns / Purchase Orders admin pages structurally.
- RBAC: a `locations.manage` (or similar) permission, and consideration of
  whether some roles should be scoped to a single location (e.g. a
  branch-level stock clerk who should not see or edit other branches'
  inventory) — this is a genuinely new RBAC dimension, not just a new
  permission string.

### 3.5 Reporting/analytics implications

- Every existing stock-level report (valuation, expiry dashboard,
  replenishment recommendations, purchasing analytics) needs both a
  per-location view and a company-wide rollup view — two modes, not a
  replacement of the existing single number.

## 4. Rough sizing

Based on the shape of comparable batches already completed in this project
(e.g. the variant-purchasing/FEFO work in Phases 5–6, or the original
purchasing/goods-receiving/FEFO build), a first, minimally-viable
multi-location implementation (schema + core transfer/receive/deduct logic +
one admin "Transfers" page + a location filter on the existing inventory
pages) is realistically **a multi-week effort of comparable size to the
entire purchasing-and-receiving system**, not a small add-on. Extending it to
every report and RBAC-scoping every role by location would be materially
more.

## 5. Concrete triggers to revisit this

Treat this as ready to plan for real (not speculatively) when **any** of the
following becomes true:

- A second physical stock-holding location (store, warehouse, dark store) is
  actually being opened or seriously budgeted, with a real target date.
- Stock is being manually reconciled or transferred between two physical
  places today by any informal/offline means (a signal that the single stock
  pool no longer reflects physical reality).
- The business needs to report on profitability, shrinkage, or stock
  accuracy **per physical location**, not just per product.

Until one of those is true, the single-location model this system already
has is the correct one, and no further preparatory work (e.g. adding an
unused `location_id` column "just in case") is recommended — it would only
add nullable-everywhere complexity against a requirement that does not yet
exist, contrary to this project's stated principle of not designing for
hypothetical future requirements.
