# Complete Sale Engine Audit
**Codebase:** `/home/user/adloom`  
**Audit Date:** 2026-05-28  
**Basis:** Direct code inspection — no speculation, no intended behavior

---

## SECTION 1 — HIGH LEVEL ARCHITECTURE

### Sale Lifecycle Overview

A sale moves through four states: `PENDING → ACTIVE → COMPLETED`, with a manual `COMPLETED → PENDING/ACTIVE` re-activation path.

```
[Merchant Creates Sale]
        │
        ▼
  PENDING (DB record)
        │
   startTime <= now?
   ┌────┴────┐
  YES       NO
   │         │
   ▼         ▼
  ACTIVE   PENDING ─── Cron/Scheduler polls ──► ACTIVE
   │                                               │
   └───────────── endTime <= now ─────────────► COMPLETED
                     (revertSale)
```

### Database Tables

**File:** `prisma/schema.prisma`

| Table | Purpose |
|---|---|
| `Sale` | Master record: metadata, status, discount params, timing |
| `SaleItem` | Per-variant snapshot: productId, variantId, originalPrice, originalCompareAt |
| `Timer` | Countdown timer display config, linked to Sale via `timerId` |
| `Coupon` | Discount codes (separate from sale engine) |
| `CouponProduct` | Products linked to coupons |
| `Session` | Shopify OAuth session tokens |

**Full Sale schema:**
```prisma
model Sale {
  id                 String     @id @default(cuid())
  shop               String
  title              String
  status             String     @default("PENDING")
  discountType       String     // "PERCENTAGE" | "FIXED_AMOUNT"
  value              Float
  startTime          DateTime
  endTime            DateTime
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt
  overrideCents      Boolean    @default(false)
  discountStrategy   String     @default("COMPARE_AT")
  excludeDrafts      Boolean    @default(true)
  excludeOnSale      Boolean    @default(false)
  allowOverride      Boolean    @default(false)
  deactivationStrategy String   @default("RESTORE")
  timerId            String?
  tagsToAdd          String?
  tagsToRemove       String?
  items              SaleItem[]
}

model SaleItem {
  id               String   @id @default(cuid())
  saleId           String
  productId        String
  variantId        String
  originalPrice    Float    @default(0)
  originalCompareAt Float?
  sale             Sale     @relation(fields: [saleId], references: [id])
}
```

### Models

| File | Functions |
|---|---|
| `app/models/sale.server.js` | `createSale`, `updateSale`, `getSale`, `getSales`, `deleteSale`, `applySale`, `revertSale`, `checkItemOverlaps`, `hasActiveSale` |
| `app/models/billing.server.js` | `getPlan`, `getPlanUsage`, `getPlanUsageForShop`, `checkLimit`, `checkGlobalVariantLimit`, `checkGlobalVariantLimitForShop`, `PLAN_LIMITS` |
| `app/models/timer.server.js` | Timer CRUD (not audited — not part of price engine) |

### Routes

| Route | Role |
|---|---|
| `app/routes/app.sales.new.jsx` | Sale creation UI + action |
| `app/routes/app.sales.$id.jsx` | Sale edit UI + action (save/deactivate/reactivate) |
| `app/routes/api.scheduler.js` | Session-dependent scheduler (runs per merchant when in-app) |
| `app/routes/api.cron.js` | Session-free global cron endpoint (requires `CRON_SECRET`) |
| `app/routes/webhooks.app.uninstalled.js` | Handles uninstall webhook |
| `app/routes/webhooks.app.subscription_update.js` | Handles plan downgrade — triggers sale reversion |

### Shopify APIs Used

| API | Where Used |
|---|---|
| `admin.graphql` — `nodes(ids)` on `ProductVariant` | `applySale`, `revertSale` — fetch current prices |
| `admin.graphql` — `productVariantsBulkUpdate` | `applySale`, `revertSale` — push price changes |
| `admin.graphql` — `collection(id).products(...)` | `app.sales.new.jsx` action — resolve collection members |
| `admin.graphql` — `products(query: "tag:X")` | `app.sales.new.jsx` action — resolve tag-based targeting |
| `admin.graphql` — `products(query: "vendor:X")` | `app.sales.new.jsx` action — resolve vendor-based targeting |
| `admin.graphql` — `appInstallation.activeSubscriptions` | `billing.server.js` — plan detection |
| `unauthenticated.admin(shop)` | `api.cron.js` — session-free admin client per shop |

---

## SECTION 2 — SALE CREATION FLOW

### Execution Path

**File:** `app/routes/app.sales.new.jsx`, `export async function action`

```
1. authenticate.admin(request)                  → get session + admin client
2. formData.get(...)                             → read all fields
3. Targeting resolution (if items empty):
   - collections → GraphQL collection.products paginated loop
   - tags        → GraphQL products(query: "tag:X") paginated loop
   - vendors     → GraphQL products(query: "vendor:X") paginated loop
   - products    → already in items[] from ResourcePicker
   - all (whole store) → NO resolution (bug — see below)
4. Validation (errors object check)
5. Deduplication via Map(variantId → item)
6. Timezone offset adjustment
7. getPlanUsage(request)                         → check totalSales limit
8. checkItemOverlaps(...)                        → check scheduling conflicts
9. checkGlobalVariantLimit(...)                  → check plan variant quota
10. createSale(...)                              → DB write, SaleItem rows created
11. If startTime <= now: applySale(sale.id, admin) → immediate activation
12. redirect('/app?success=true&count=N')
```

### Validation Logic

```js
const errors = {};
if (!title) errors.title = "Title is required";
if (!value) errors.value = "Value is required";
if (!startTime) errors.startTime = "Start time is required";
if (!endTime) errors.endTime = "End time is required";
if (items.length === 0) errors.items = "Select at least one product or collection";
```

**No validation for:**
- `value <= 0` (zero discount allowed)
- `startTime >= endTime` (inverted range not caught server-side)
- `discountType` enum correctness
- `discountStrategy` enum correctness
- Duplicate productId/variantId pairs (handled by dedup, not rejected)

### Database Writes

`createSale` in `sale.server.js`:

```js
prisma.sale.create({
  data: {
    shop, title, discountType, value: parseFloat(value),
    startTime: new Date(startTime), endTime: new Date(endTime),
    status: "PENDING",
    overrideCents, discountStrategy, excludeDrafts, excludeOnSale,
    allowOverride, deactivationStrategy, timerId, tagsToAdd, tagsToRemove,
    items: {
      create: items.map(item => ({
        productId: item.productId,
        variantId: item.variantId,
        originalPrice: 0,          // ← always written as 0 at creation
        originalCompareAt: null,   // ← always null at creation
      }))
    }
  }
})
```

**`originalPrice` is hardcoded to `0` at creation time.** The real value is only written later during `applySale` via `prisma.$transaction`.

### Shopify API Calls at Creation

- **Collections:** `collection(id).products(first: 250)` — up to 15 pages (3,750 products), variants fetched with `variants(first: 50)` per product
- **Tags/Vendors:** `products(first: 250, query: "tag:X OR tag:Y")` — same 15-page limit
- **Products:** No API call — ResourcePicker data passed directly from client
- **Whole store:** No API call at all

### What Can Fail at Creation

| Failure | Consequence |
|---|---|
| GraphQL rate limit during collection/tag/vendor resolve | Items array stays partial or empty; `errors.items` fires and blocks creation |
| `appliesToType === "all"` | No resolution runs; `items.length === 0`; `errors.items` blocks creation entirely |
| `createSale` DB write fails | `catch` block returns `{ errors: { base: "Failed to create sale" } }` — no partial state |
| `applySale` called immediately (startTime <= now) and fails | Sale record exists in DB as `PENDING` but is never activated; no automatic retry |
| `variants(first: 50)` per product in collection query | Products with more than 50 variants are silently truncated at 50 |

---

## SECTION 3 — TARGETING ENGINE

### How Targeting Works

Targeting is **snapshot-based, resolved once at sale creation time** in the action of `app/routes/app.sales.new.jsx`. Variants are fetched via GraphQL, stored as `SaleItem` rows, and **never recalculated**.

### By Targeting Type

#### Products/Variants (`appliesToType === "products"`)
- Client uses Shopify ResourcePicker to select products
- All variants of selected products are extracted client-side from the ResourcePicker response
- Sent in `items[]` form field as JSON
- **No server-side API call** — the client payload is trusted directly

#### Collections (`appliesToType === "collections"`)
- **File:** `app/routes/app.sales.new.jsx` lines ~95–145
- GraphQL query: `collection(id).products(first: 250, after: $cursor).edges.node.variants(first: 50)`
- Paginated: up to 15 pages = ~3,750 products per collection
- Multiple collections are looped and appended into one `items` array
- **Variant cap per product:** `variants(first: 50)` — products with 51+ variants are truncated silently

#### Tags (`appliesToType === "tags"`)
- **File:** `app/routes/app.sales.new.jsx` lines ~148–190
- GraphQL: `products(first: 250, query: "tag:X OR tag:Y")`
- Paginated: up to 15 pages
- Same 50-variant-per-product cap

#### Vendors (`appliesToType === "vendors"`)
- **File:** `app/routes/app.sales.new.jsx` lines ~193–240
- GraphQL: `products(first: 250, query: "vendor:X OR vendor:Y")`
- Paginated: up to 15 pages
- Same 50-variant-per-product cap

#### Whole Store (`appliesToType === "all"`)
- **No resolution code exists.**
- The action only checks `if (items.length === 0)` before branching on `appliesToType`
- No branch for `appliesToType === "all"` exists
- `items` remains `[]`
- Validation block fires: `errors.items = "Select at least one product or collection"`
- **Sale creation is blocked entirely.** "Whole store" is a non-functional UI option.

### Dynamic vs Snapshot

| Question | Answer |
|---|---|
| Snapshot-based or dynamic? | **Snapshot.** Variants resolved once at creation, stored in `SaleItem` |
| When are products resolved? | At `action` execution in `app.sales.new.jsx` |
| When are variants resolved? | Same moment — variants extracted from product nodes during GraphQL resolution |
| Are results cached? | No — each sale creation makes fresh API calls |
| Are results recalculated later? | **Never.** No background job refreshes `SaleItem` rows |

### Edge Cases

| Scenario | Actual Behavior |
|---|---|
| Product added to collection after sale creation | **Not included.** Snapshot was taken at creation. |
| Product removed from collection after creation | **Still discounted.** It's in the `SaleItem` snapshot. |
| Tag added to product after sale creation | **Not included** if tag-based targeting was used. |
| Tag removed from product after creation | **Still discounted.** Snapshot-only. |
| Vendor changes after creation | **No effect.** Snapshot-only. |
| New product matching targeting rules | **Not included.** Never added to snapshot. |
| Variant added to product after creation | **Not included.** Only variants present at creation time are stored. |

---

## SECTION 4 — VARIANT MODIFICATION ENGINE

### How Variants Are Discovered

**File:** `app/models/sale.server.js`, function `applySale`

1. `prisma.sale.findUnique({ include: { items: true } })` — loads all `SaleItem` rows
2. Items split into chunks of 250 (`BATCH_SIZE = 250`)
3. Each chunk queried: `admin.graphql(nodes(ids: $ids))` to fetch current `price` and `compareAtPrice` from Shopify
4. Results mapped into `variantMap` (Map keyed by variant GID)
5. Items not found in `variantMap` are **silently skipped** with `console.warn`

### How Prices Are Modified

After computing `newPrice` and `newCompareAt` per variant:

```js
const updatesByProduct = itemsToUpdate.reduce((acc, item) => {
  if (!acc[item.productId]) acc[item.productId] = [];
  acc[item.productId].push(item);
  return acc;
}, {});

for (const productId in updatesByProduct) {
  await admin.graphql(mutation, {
    variables: { productId, variants: [...] }
  });
}
```

Mutation used: `productVariantsBulkUpdate(productId, variants: [{ id, price, compareAtPrice }])`

Variants are **grouped by productId** and sent as bulk mutations — one mutation call per product.

### `overrideCents` Field

The `overrideCents` boolean is stored in `Sale` and passed through the UI. However, **it is never applied in `applySale`**. The price computation in `applySale` calculates `newPrice = basePrice - discountAmount` and calls `.toFixed(2)` — no cents rounding logic exists. `overrideCents` is a dead field in the activation engine.

The only place `overrideCents` is used is the **client-side live preview** function `getPreviewData()` in `app.sales.new.jsx`:
```js
if (overrideCents) {
  discountedPrice = Math.floor(discountedPrice) + 0.99;
}
```
This is display-only. The actual activation does not apply it.

### `excludeDrafts` / `excludeOnSale`

Both flags are stored in `Sale`. Neither is applied during `applySale`. The function loads `sale.items` from DB and processes all of them — no filter is applied based on these flags.

### What Happens With 100+ Variant Products

- Collection/tag/vendor queries use `variants(first: 50)` per product
- Products with more than 50 variants are truncated to 50 at snapshot time
- Direct product selection via ResourcePicker includes all variants returned by the picker (Shopify ResourcePicker limit applies)
- `applySale` itself has no per-product variant cap — it processes whatever is in `SaleItem`
- The `productVariantsBulkUpdate` mutation is chunked at 250 items per product

### What Happens With New Variants Added After Activation

Nothing. The `SaleItem` snapshot is static. New variants are never added. They receive no discount.

### What Happens if Variants Are Deleted

**File:** `app/models/sale.server.js`, `applySale` and `revertSale`

```js
if (!variantData) {
  console.warn(`[ApplySale] Variant ${item.variantId} not found in Shopify. Skipping.`);
  continue;
}
```

```js
if (!variantData) {
  console.warn(`[RevertSale] Variant ${item.variantId} not found. Skipping reversion.`);
  continue;
}
```

- The item is skipped
- The `SaleItem` row is **not deleted from DB**
- `originalPrice` in the stale `SaleItem` row remains as-is forever
- No notification to merchant

### What Happens if a Merchant Edits a Variant Price Manually

Handled in `revertSale` via manual-change detection (see Section 10 and 12). If the current Shopify price doesn't match the expected discounted price, the variant is skipped during reversion — the manual price is preserved.

---

## SECTION 5 — PRICE CALCULATION RULES

All price calculation occurs in `applySale`, `app/models/sale.server.js`.

### Strategy: `COMPARE_AT` (default)

**Logic:**
```js
basePrice = currentCompareAt || currentPrice;
targetCompareAt = basePrice;
discountAmount = basePrice * (value / 100)   // if PERCENTAGE
discountAmount = value                         // if FIXED_AMOUNT
newPrice = basePrice - discountAmount
newCompareAt = targetCompareAt  // = original compareAt or original price
```

**Intent:** Use compare-at price as the "real" price basis. Sets compare-at to the base, applies discount to get new price.

**Example — PERCENTAGE 20%, product $100 price, $120 compare-at:**
```
basePrice = 120
discountAmount = 120 * 0.20 = 24
newPrice = 120 - 24 = 96.00
newCompareAt = 120.00
```

**Example — PERCENTAGE 20%, product $100 price, no compare-at:**
```
basePrice = 100 (fallback)
discountAmount = 100 * 0.20 = 20
newPrice = 100 - 20 = 80.00
newCompareAt = 100.00
```

### Strategy: `USE_CURRENT_AS_COMPARE`

```js
basePrice = currentPrice;
targetCompareAt = currentPrice;
newPrice = currentPrice - discountAmount
newCompareAt = currentPrice
```

**Example — 20% off $80 product:**
```
basePrice = 80
newPrice = 80 - 16 = 64.00
newCompareAt = 80.00
```

### Strategy: `KEEP_COMPARE_AT`

```js
basePrice = currentPrice;
targetCompareAt = currentCompareAt;  // unchanged
newPrice = currentPrice - discountAmount
newCompareAt = currentCompareAt  // whatever was there before
```

**Example — 20% off $80 product with $100 compare-at:**
```
newPrice = 80 - 16 = 64.00
newCompareAt = 100.00 (unchanged)
```

**Example — 20% off $80 product with no compare-at:**
```
newPrice = 64.00
newCompareAt = null (unchanged)
```

### Strategy: `INCREASE_COMPARE`

```js
newPrice = currentPrice;            // price unchanged
newCompareAt = currentPrice + discountAmount;
```

**Example — PERCENTAGE 20%, $100 product:**
```
discountAmount = 100 * 0.20 = 20
newPrice = 100.00 (unchanged)
newCompareAt = 100 + 20 = 120.00
```

**Example — FIXED_AMOUNT $15, $80 product:**
```
newPrice = 80.00 (unchanged)
newCompareAt = 80 + 15 = 95.00
```

### Rounding

All computed prices use `.toFixed(2)` — standard two-decimal rounding. No floor/ceiling. No `.99` cent override (despite the `overrideCents` field existing — see Section 4).

### Floor Clamp

```js
if (newPrice < 0) newPrice = 0;
```

Applied before `.toFixed(2)`. Compare-at is not clamped.

### FIXED_AMOUNT Edge Case

If `FIXED_AMOUNT` discount exceeds the product price, `newPrice` hits the floor clamp and is set to `0.00`. No warning. No skip.

---

## SECTION 6 — ORIGINAL DATA PRESERVATION

### What Is Stored

**File:** `app/models/sale.server.js`, `createSale` and `applySale`

At **creation time** (`createSale`):
```js
originalPrice: 0,        // always 0 — placeholder
originalCompareAt: null  // always null — placeholder
```

At **activation time** (`applySale`), after fetching current prices from Shopify:
```js
prisma.$transaction(
  itemsToUpdate.map(update =>
    prisma.saleItem.update({
      where: { id: update.id },
      data: {
        originalPrice: update.originalPrice,       // real price from Shopify
        originalCompareAt: update.originalCompareAt // real compareAt from Shopify (or null)
      }
    })
  )
)
```

### DB Fields Storing Original Data

| Field | Type | Stored When | Notes |
|---|---|---|---|
| `SaleItem.originalPrice` | `Float @default(0)` | At `applySale` | Written as 0 at creation — overwritten during activation |
| `SaleItem.originalCompareAt` | `Float?` | At `applySale` | `null` if no compare-at existed |
| `SaleItem.variantId` | `String` | At creation | The GID used for all Shopify calls |
| `SaleItem.productId` | `String` | At creation | Used for bulk mutation grouping |
| `Sale.startTime` | `DateTime` | At creation | |
| `Sale.endTime` | `DateTime` | At creation | |
| `Sale.discountType` | `String` | At creation | Used during restoration calculation |
| `Sale.value` | `Float` | At creation | Used during restoration calculation |
| `Sale.discountStrategy` | `String` | At creation | Used during restoration calculation |

### Critical Gap: `originalPrice: 0` Window

Between `createSale` (writes `originalPrice: 0`) and `applySale` (writes real price via `$transaction`), there is a window where the DB has `originalPrice = 0` for all items.

If the server crashes during this window, or if `applySale`'s Shopify API calls fail partway, **the sale transitions to an inconsistent state** where some `SaleItem` rows have `originalPrice = 0` and the sale may be stuck as `PENDING` forever.

There is no recovery mechanism for this state.

### `updateSale` Behavior

**File:** `sale.server.js`, `updateSale`

When a sale is edited:
```js
await prisma.saleItem.deleteMany({ where: { saleId: id } });
// then re-create items with:
originalPrice: item.originalPrice || 0,
originalCompareAt: item.originalCompareAt || null,
```

For an **active sale**, editing deletes all `SaleItem` rows and re-creates them. The re-created rows use whatever `originalPrice` was passed from the client form. In the edit form (`app.sales.$id.jsx`), `selectedItems` is pre-filled from `sale.items.map(item => ({ ..., originalPrice: item.originalPrice }))` — so the price passes through. However, if the merchant changes the item selection, the new items have `originalPrice: 0`.

---

## SECTION 7 — SALE ACTIVATION

### Two Activation Paths

#### Path 1: Immediate (at creation)
**File:** `app/routes/app.sales.new.jsx`, action function

```js
if (start <= now) {
  updatedCount = await applySale(sale.id, admin);
}
```

Runs synchronously in the HTTP request handler. If `applySale` throws, the error is caught at the outer `try/catch` and returns `{ errors: { base: "Failed to create sale" } }`. The sale record **already exists in DB as `PENDING`** at this point — it is not rolled back.

#### Path 2: Scheduled via Cron
Two endpoints can trigger scheduled activation:

**`api.scheduler.js`** — Session-dependent
- Uses `authenticate.admin(request)` — **requires an active merchant session**
- Only processes sales for the **current authenticated shop**
- Only fires when a merchant is actively using the app (visiting the scheduler URL)
- Polls `PENDING` sales where `startTime <= now`

**`api.cron.js`** — Session-free, global
- Uses `unauthenticated.admin(shop)` — **no session required**
- Processes **all shops** globally
- Protected by `CRON_SECRET` (query param or `x-cron-secret` header)
- Returns 500 if `CRON_SECRET` env var is not set
- This is the intended production cron mechanism

### Frequency / Trigger

No internal scheduler or timer. Both endpoints are **HTTP GET endpoints** that must be called externally. There is no built-in interval. If no external cron service calls `api.cron.js`, scheduled sales are **never automatically activated**.

### Retry Behavior

- No retry logic in either scheduler
- If `applySale` throws for a specific sale, `api.cron.js` catches the error, logs it, pushes to `results.errors[]`, and **continues to the next sale**
- The failed sale remains `PENDING` — it will be attempted again on the next cron run (since `startTime <= now` will still match)
- This is effectively infinite retry with no backoff and no failure state

### Reactivation (Manual)

**File:** `app/routes/app.sales.$id.jsx`

```js
if (intent === "reactivate") {
  await applySale(params.id, admin);
  return json({ success: true });
}
```

Available for `COMPLETED` or `PENDING` sales. Calls `applySale` directly. The guard in `applySale`:
```js
if (!sale || sale.status === "ACTIVE" || sale.status === "COMPLETED") return;
```
This means **a `COMPLETED` sale cannot be reactivated** — `applySale` silently returns without doing anything. The UI shows a "Reactivate" button for `COMPLETED` sales, but clicking it does nothing.

---

## SECTION 8 — ACTIVE SALE STATE

### How the System Tracks Active Sales

**Solely via the `Sale.status` field in the database.**

Values:
- `"PENDING"` — scheduled, not yet active
- `"ACTIVE"` — currently live, prices modified
- `"COMPLETED"` — ended, prices restored

There are no Shopify metafields, no in-memory state, no Redis/cache layer.

### Active Sale Queries

Anywhere the system needs to know if a sale is active, it queries:
```js
prisma.sale.findMany({ where: { shop, status: "ACTIVE" } })
```

Example in `billing.server.js`:
```js
const activeSales = await prisma.sale.findMany({
  where: { shop, status: "ACTIVE" },
  include: { items: true }
});
```

### `hasActiveSale` Function

**File:** `sale.server.js`

```js
export async function hasActiveSale(shop) {
  const activeSale = await prisma.sale.findFirst({
    where: { shop, status: "ACTIVE" },
  });
  return !!activeSale;
}
```

### No External Confirmation

The system does not verify with Shopify that variant prices actually changed when marking a sale `ACTIVE`. After `productVariantsBulkUpdate` mutations fire, the `Sale.status` is updated to `ACTIVE` regardless of whether Shopify's `userErrors` array contained errors:

```js
// No userErrors check:
await admin.graphql(mutation, { variables: { productId, variants } });
// ...
await prisma.sale.update({ where: { id: saleId }, data: { status: "ACTIVE" } });
```

A sale can be `ACTIVE` in DB even if Shopify rejected all price mutations.

---

## SECTION 9 — COLLISION PROTECTION

### Detection Logic

**File:** `app/models/sale.server.js`, `checkItemOverlaps`

```js
const overlappingSales = await prisma.sale.findMany({
  where: {
    shop,
    status: { in: ["ACTIVE", "PENDING"] },
    NOT: excludeSaleId ? { id: excludeSaleId } : undefined,
    startTime: { lt: end },
    endTime: { gt: start },
  },
  include: {
    items: {
      where: { variantId: { in: variantIds } }
    }
  }
});

overlappingSales.forEach(sale => {
  if (sale.items.length > 0) {
    conflicts.push(`"${sale.title}"`);
  }
});
```

Overlap condition: `startA < endB AND endA > startB` — this is standard exclusive overlap. Two sales that end and start at the exact same timestamp do **not** conflict.

### Collision Matrix

| Scenario | Handled? | Notes |
|---|---|---|
| Product targeted by two active sales (same window) | **Yes** — blocked at creation/update | `checkItemOverlaps` checks overlapping `ACTIVE`/`PENDING` sales |
| Collection sale + product sale (same variants) | **Yes** — same check, variant-level comparison | Both resolve to same `variantId` entries |
| Whole Store sale + any other sale | **No** — whole store sales cannot be created (bug in Section 3) | N/A in practice |
| Two scheduled `PENDING` sales, same variants, overlapping dates | **Yes** — blocked at creation | Status check includes `PENDING` |
| Exact boundary: sale A ends at 10:00, sale B starts at 10:00 | **Allowed** — not a conflict | `lt` / `gt` (not `lte`/`gte`) |
| Same variants in a sale update | **Yes** — `excludeSaleId` parameter excludes current sale | Won't conflict with itself |
| Cron activates a sale bypassing UI validation | **Yes** — `checkItemOverlaps` called in both scheduler routes | Overlap checked before `applySale` |

### Timer Conflict Check

```js
if (targetTimerId && sale.timerId && targetTimerId !== sale.timerId) {
  conflicts.push(`(Timer conflict with "${sale.title}")`);
}
```

Only fires if **both** sales have timer IDs and they differ. One sale without a timer never causes a timer conflict.

### What Is NOT Checked

- Coupon + Sale overlap (separate systems entirely)
- Whole store + specific product (whole store creation blocked)
- COMPLETED sales — not included in overlap check (by status filter)

---

## SECTION 10 — MANUAL MERCHANT CHANGES

### Detection in `revertSale`

**File:** `app/models/sale.server.js`, `revertSale`

For each variant, the system computes the **expected discounted price** from stored `originalPrice` and sale parameters, then compares to the **current Shopify price**:

```js
const priceChanged = Math.abs(currentPrice - expectedDiscountedPrice) > 0.01
  && !["0.00", "0"].includes(currentPrice.toFixed(2));

let compareAtChanged = false;
if (currentCompareAt !== null || expectedCompareAt !== null) {
   if (currentCompareAt === null || expectedCompareAt === null
       || Math.abs(currentCompareAt - expectedCompareAt) > 0.01) {
     compareAtChanged = true;
   }
}

if (priceChanged || compareAtChanged) {
  console.warn(`[RevertSale] Manual change detected...`);
  continue;  // skip restoration
}
```

### Behavior by Change Type

| Merchant Action | System Behavior |
|---|---|
| Changes product price while sale active | If delta > $0.01 from expected: **variant skipped during reversion**, original price lost |
| Changes compare-at price while sale active | Same skip logic via `compareAtChanged` flag |
| Deletes a variant | Variant skipped silently; `SaleItem` row retained forever |
| Deletes a product | All variants for product skipped silently; `SaleItem` rows retained |
| Changes product tags | No effect — snapshot-based targeting, no re-evaluation |
| Changes collection assignment | No effect — snapshot-based |
| Changes vendor | No effect — snapshot-based |

### `deactivationStrategy: "REPLACE_WITH_COMPARE"`

```js
if (sale.deactivationStrategy === "REPLACE_WITH_COMPARE" && currentCompareAt) {
  targetPrice = String(currentCompareAt);
  targetCompareAt = null;
}
```

When this strategy is set, on reversion, the variant's **current compare-at price** (the discounted compare-at set during `applySale`) becomes the new price, and compare-at is cleared. This only executes if the variant passes the manual-change detection check first.

### False Positives in Manual Change Detection

The `priceChanged` check has a special carve-out: if `currentPrice.toFixed(2)` is `"0.00"` or `"0"`, manual change detection is bypassed. This means if a merchant manually sets a price to $0, the variant **will be restored** even though the price was manually changed.

The `> 0.01` threshold is floating-point tolerance but is not always sufficient — certain combinations of percentage discounts and prices can produce rounding artifacts where the expected vs. actual price differs by exactly `0.01` or `0.009`, leading to false-positive manual-change detection and skipped restoration.

---

## SECTION 11 — SALE EXPIRATION

### Expiration Detection

**File:** `api.cron.js` (global) and `api.scheduler.js` (per-shop)

```js
const salesToEnd = await prisma.sale.findMany({
  where: {
    status: "ACTIVE",
    endTime: { lte: now },
  },
});

for (const sale of salesToEnd) {
  await revertSale(sale.id, admin);
}
```

Finds all `ACTIVE` sales where `endTime <= now`. No shop filter in `api.cron.js` (global). Shop-filtered in `api.scheduler.js`.

### Restoration Flow (`revertSale`)

**File:** `app/models/sale.server.js`, `revertSale`

```
1. Load sale + items from DB
2. Guard: if status !== "ACTIVE", return early
3. For each chunk of 250 items:
   a. Query Shopify: nodes(ids: variantIds) → get current price + compareAt
   b. Build variantMap
   c. For each item:
      - if variant not in Shopify → skip (console.warn)
      - compute expected discounted price from originalPrice + sale params
      - compare expected vs current (manual change detection)
      - if changed → skip (console.warn)
      - else → add to updatesByProduct
4. For each productId in updatesByProduct:
   - execute productVariantsBulkUpdate mutation
5. prisma.sale.update: status → "COMPLETED"
```

### After Reversion

- `Sale.status` = `"COMPLETED"`
- `SaleItem` rows are retained (not deleted)
- Variants that were skipped (deleted or manually changed) retain whatever price they currently have in Shopify
- No notification to merchant about skipped variants

### Tag Application (Post-sale)

`Sale.tagsToAdd` and `Sale.tagsToRemove` fields exist in the schema and are stored. However, **`revertSale` does not apply these tags.** The tag logic is never implemented in the engine. These fields are stored but never used anywhere in sale activation or deactivation.

---

## SECTION 12 — INTEGRITY CHECKS

### Complete List of Integrity Checks

| Check | Location | What It Does |
|---|---|---|
| Variant existence | `applySale`, `revertSale` | If variant not found in Shopify, skip with `console.warn` |
| Manual price change detection | `revertSale` | Computes expected price, compares to current; skips if delta > 0.01 |
| Manual compare-at change detection | `revertSale` | Compares expected vs current compareAt; skips if different |
| Sale status guard | `applySale` | `if (sale.status === "ACTIVE" \|\| sale.status === "COMPLETED") return` |
| Sale status guard | `revertSale` | `if (sale.status !== "ACTIVE") return` |
| Overlap check | `checkItemOverlaps` | Variant-level overlap across time windows |
| Plan sale limit | `getPlanUsage` | `totalSales.used >= totalSales.limit` |
| Plan variant limit | `checkGlobalVariantLimitForShop` | Sum unique variants across overlapping active/pending sales |
| Negative price clamp | `applySale` | `if (newPrice < 0) newPrice = 0` |
| Zero-price carve-out | `revertSale` | Bypasses manual change detection if current price is "0.00" |
| Empty items guard | `applySale` | `if (itemsToUpdate.length === 0) console.warn(...)` — does NOT abort |

### What Is NOT Checked

| Missing Check | Impact |
|---|---|
| `userErrors` in `productVariantsBulkUpdate` response | Shopify rejections are silently ignored |
| `originalPrice === 0` at reversion time | Restores $0 original price as if it were real |
| `overrideCents` during activation | Never applied to computed prices |
| `excludeDrafts` during activation | Draft product variants are discounted regardless |
| `excludeOnSale` during activation | Variants with existing compare-at prices are discounted regardless |
| Duplicate `variantId` across `SaleItem` rows | Deduplication happens client-side before creation but not enforced at DB level |

---

## SECTION 13 — FAILURE SCENARIOS

### Shopify API Timeout

`applySale` and `revertSale` use `await admin.graphql(...)` with no explicit timeout or abort controller. If Shopify times out:
- The batch loop catches the error: `catch (batchError) { console.error(...) }`
- That batch is skipped
- Processing continues with remaining batches
- The sale is still marked `ACTIVE`/`COMPLETED` at the end — partial updates committed

### Shopify Rate Limits

No rate limit handling. No retry on 429. No `Retry-After` header parsing. A rate-limited batch is caught by the batch `try/catch`, logged, and skipped — same outcome as a timeout.

### Database Failure

`createSale` and all DB writes use standard Prisma — if the DB is unavailable, the call throws and is caught by the outer `try/catch`. Returns `{ errors: { base: "Failed to create sale" } }`. No partial state issue at creation.

For `applySale`: if the `prisma.$transaction` fails after Shopify mutations have already executed, Shopify prices are already changed but `SaleItem.originalPrice` values were never written. The sale remains `PENDING`. On next cron run, `applySale` is called again — it re-fetches current Shopify prices (now already discounted) and overwrites `originalPrice` with the already-discounted price. Restoration is then impossible.

### Server Restart

If the server restarts mid-`applySale`:
- Any Shopify mutations that already fired are permanent
- `prisma.$transaction` is rolled back (Prisma transaction atomicity)
- `originalPrice` values may remain at `0`
- Sale status remains `PENDING`
- Next cron run attempts `applySale` again — re-fetches already-discounted prices as "original"

### Sale Deleted While Active

**File:** `sale.server.js`, `deleteSale`

```js
if (sale.status === "ACTIVE") {
  await revertSale(saleId, admin);
}
await prisma.saleItem.deleteMany({ where: { saleId } });
await prisma.sale.delete({ where: { id: saleId } });
```

If `revertSale` throws, the catch in `deleteSale` re-throws. The sale and its items are **not deleted** — caller receives an error. Prices remain discounted.

### Product Deleted

Variant nodes return `null` from Shopify's `nodes(ids)` query. Caught by:
```js
if (!variantData) { console.warn(...); continue; }
```
Skipped in both `applySale` and `revertSale`. `SaleItem` row remains in DB permanently.

### Variant Deleted

Same as product deletion — skipped silently.

### Merchant Uninstall

**File:** `webhooks.app.uninstalled.js`

```js
if (session) {
  await db.session.deleteMany({ where: { shop } });
}
```

Only the `Session` table is cleared. **All `Sale`, `SaleItem`, `Timer`, `Coupon` records are retained.** Active sales remain `ACTIVE` in DB with no mechanism to revert them. Shopify prices remain discounted permanently if the merchant uninstalls mid-sale.

The comment in the code notes that `shop/redact` fires 48 hours later and is the "compliant" time to delete data. However, there is no `shop/redact` webhook handler visible in the codebase.

### Billing Downgrade

**File:** `webhooks.app.subscription_update.js`

1. Parses new plan from webhook payload (or falls back to `getPlanWithAdmin`)
2. Checks `PLAN_LIMITS[plan].maxSales`
3. If active sales exceed limit: deactivates most recently created ones first (LIFO)
4. Calls `revertSale` for each excess sale
5. If `admin` is unavailable in the webhook context: returns 200 without reverting — sales stay active

### Store Closure (Shopify closes shop)

No handler. Sales remain `ACTIVE` in DB. No revert mechanism fires. Prices are permanently discounted on a non-operational store.

---

## SECTION 14 — REVIEWER RISK ASSESSMENT

### CRITICAL RISKS

**1. `originalPrice: 0` Revert-to-Zero on Crash**
- **File:** `sale.server.js`, `createSale` + `applySale`
- `originalPrice` is written as `0` at creation. If `applySale` fails mid-transaction or the server restarts between the Shopify mutations and the `$transaction`, `originalPrice` stays `0`. On next cron run, `applySale` re-fetches current (already discounted) prices and stores them as `originalPrice`. Restoration then sets all prices to the discounted price permanently.
- **Impact:** Permanent price corruption. Original prices irretrievably lost.

**2. Whole Store Targeting Blocks Sale Creation**
- **File:** `app.sales.new.jsx` action
- `appliesToType === "all"` has no resolution branch. `items` remains empty. `errors.items` fires. The sale cannot be created. The UI shows the option but it is non-functional.
- **Impact:** Shopify review risk — advertised feature is broken.

**3. `applySale` Marks Sale ACTIVE Without Verifying Shopify Response**
- **File:** `sale.server.js`, `applySale`
- `productVariantsBulkUpdate` `userErrors` are never inspected. If Shopify rejects the mutation (e.g., variant locked, permissions issue), the sale is still marked `ACTIVE` in DB but prices were never actually changed. On expiry, `revertSale` will "restore" to original prices — potentially changing prices that were never discounted to a different value.
- **Impact:** Price corruption. Variants may have their price set to a "restored" value they never had during the sale.

**4. `revertSale` Called on Partially-Applied Sale**
- Follows from Risk #1. If `originalPrice = 0` (from a crashed `applySale`), reversion sets all prices to `0.00`. Every product becomes free.
- **Impact:** Critical — products become $0.

**5. No `shop/redact` Webhook Handler**
- Active sales are never reverted on uninstall. Prices remain discounted.
- **Impact:** Merchant store data issue. Shopify GDPR compliance risk.

**6. Reactivation of `COMPLETED` Sales Is Silent No-Op**
- `applySale` guard: `if (sale.status === "COMPLETED") return`. The UI shows "Reactivate" for completed sales. Clicking it does nothing. Merchant receives a success toast but nothing happened.
- **Impact:** Merchant confusion, broken feature, Shopify review risk.

### MEDIUM RISKS

**7. `overrideCents` Is a Dead Feature**
- Stored in DB, shown in UI, applied in client-side preview only. Never applied in `applySale`. What merchant configures ≠ what gets applied.
- **Impact:** Merchant confusion, broken advertised feature.

**8. `excludeDrafts` / `excludeOnSale` Never Enforced**
- Both flags stored in DB. Neither applied during `applySale`. Draft products and already-on-sale products are discounted regardless of these settings.
- **Impact:** Merchant-configured exclusions silently ignored.

**9. `tagsToAdd` / `tagsToRemove` Never Applied**
- Fields exist in schema and UI. Never consumed by `applySale` or `revertSale`. Tag logic is dead code.
- **Impact:** Broken feature.

**10. Variants > 50 per Product Silently Truncated**
- Collection/tag/vendor resolution uses `variants(first: 50)`. Products with 51+ variants have their extra variants silently excluded.
- **Impact:** Partial sale application — merchant thinks all variants are discounted, they are not.

**11. Manual Change Detection False Positives**
- Floating-point comparison `Math.abs(...) > 0.01` can produce false positives on certain price/discount combinations. Legitimate variants are skipped during restoration.
- **Impact:** Original prices not restored for some variants.

**12. Session-Dependent Scheduler (`api.scheduler.js`)**
- Only fires for merchants currently in-app. If a merchant's scheduled sale start time passes while they are not using the app, the sale is not activated until they return.
- **Impact:** Sales not starting on time. Only `api.cron.js` works correctly; requires external cron setup.

**13. Plan Downgrade Webhook: No Admin Client → No Revert**
- If `admin` is not available in the webhook, the handler returns 200 without reverting excess sales.
- **Impact:** Plan limits not enforced on downgrade if admin client is unavailable.

### LOW RISKS

**14. `startTime >= endTime` Not Validated Server-Side**
- Only caught client-side. A crafted POST can create a sale with an inverted time range.

**15. `value = 0` Allowed**
- A 0% or $0 discount creates a valid, active sale that doesn't change any prices.

**16. `SaleItem` Rows Never Cleaned Up for Deleted Variants**
- Stale rows accumulate in DB. No impact on correctness beyond storage growth.

**17. `api.cron.js` Returns 500 if `CRON_SECRET` Not Set**
- If the env var is missing, all scheduled activations and expirations silently fail.

**18. `COMPLETED` sale `reactivate` intent calls `applySale` which returns early**
- Already covered as Critical #6 above; technically UI/UX level issue too.

---

## SECTION 15 — FINAL DELIVERABLES

### 1. Complete Sale Lifecycle Diagram

```
[Merchant: New Sale Form]
         │
         ▼
[app.sales.new.jsx action]
  ├─ Resolve targeting (collections/tags/vendors via GraphQL)
  ├─ Validate fields + items.length > 0
  ├─ checkItemOverlaps (ACTIVE + PENDING sales)
  ├─ checkGlobalVariantLimit (billing)
  └─ createSale() → DB: Sale(PENDING) + SaleItem rows (originalPrice=0)
         │
    startTime <= now?
    ┌────┴────┐
   YES       NO
    │         │
    ▼         └──────────────────────────────────┐
[applySale()]                                    │
  ├─ Fetch current prices (Shopify GraphQL)      │
  ├─ Compute newPrice/newCompareAt               │
  ├─ productVariantsBulkUpdate (Shopify)         │
  ├─ prisma.$transaction: update SaleItem orig   │
  └─ Sale.status = "ACTIVE"                      │
         │                                       │
         │                        [api.cron.js] ─┘
         │                         ├─ Find PENDING where startTime <= now
         │                         └─ applySale() per sale
         │
    endTime <= now?
    [api.cron.js polls]
         │
         ▼
[revertSale()]
  ├─ Fetch current prices (Shopify GraphQL)
  ├─ Manual change detection per variant
  ├─ productVariantsBulkUpdate: restore original prices
  └─ Sale.status = "COMPLETED"

[Manual deactivate]     → revertSale() directly
[Manual reactivate]     → applySale() [BROKEN for COMPLETED status]
[Billing downgrade]     → revertSale() for excess sales
[Uninstall webhook]     → Only clears Session table, NO revert
```

### 2. Variant Modification Flow Diagram

```
applySale(saleId, admin)
         │
         ▼
prisma.sale.findUnique (include items)
         │
    chunk items into 250s
         │
    for each chunk:
         ├─ admin.graphql: nodes(ids) → price, compareAtPrice
         ├─ build variantMap
         └─ for each item:
               variantData exists?
               ├─ NO  → console.warn, skip (SaleItem unchanged)
               └─ YES →
                    apply discountStrategy:
                    ├─ COMPARE_AT          → basePrice = compareAt || price
                    ├─ USE_CURRENT_AS_COMPARE → basePrice = price
                    ├─ KEEP_COMPARE_AT     → basePrice = price, keep compareAt
                    └─ INCREASE_COMPARE    → price unchanged, raise compareAt
                         │
                    apply discount:
                    ├─ PERCENTAGE: newPrice = basePrice * (1 - value/100)
                    └─ FIXED_AMOUNT: newPrice = basePrice - value
                         │
                    newPrice < 0? → clamp to 0
                         │
                    push to itemsToUpdate[]
         │
    group itemsToUpdate by productId
         │
    for each productId:
         └─ admin.graphql: productVariantsBulkUpdate
              (errors NOT checked)
         │
    prisma.$transaction: update SaleItem.originalPrice + originalCompareAt
         │
    prisma.sale.update: status = "ACTIVE"
```

### 3. Restoration Flow Diagram

```
revertSale(saleId, admin)
         │
         ▼
prisma.sale.findUnique (include items)
         │
    status === "ACTIVE"?  NO → return early
         │
    chunk items into 250s
         │
    for each chunk:
         ├─ admin.graphql: nodes(ids) → current price, compareAtPrice
         ├─ build variantMap
         └─ for each item:
               variantData exists?
               ├─ NO  → console.warn, skip (stale SaleItem stays in DB)
               └─ YES →
                    compute expectedDiscountedPrice from originalPrice
                         │
                    priceChanged = |currentPrice - expected| > 0.01
                         AND currentPrice != "0.00"
                    compareAtChanged = mismatch in compareAt values
                         │
                    priceChanged OR compareAtChanged?
                    ├─ YES → console.warn, skip (manual change preserved)
                    └─ NO →
                         deactivationStrategy === "REPLACE_WITH_COMPARE"
                           AND currentCompareAt exists?
                         ├─ YES → targetPrice = currentCompareAt, targetCompareAt = null
                         └─ NO  → targetPrice = originalPrice, targetCompareAt = originalCompareAt
                              │
                         add to updatesByProduct
         │
    for each productId:
         └─ admin.graphql: productVariantsBulkUpdate (restore prices)
              (errors NOT checked)
         │
    prisma.sale.update: status = "COMPLETED"
```

### 4. Collision Matrix

| Sale A | Sale B | Same Variants? | Same Window? | Blocked? |
|---|---|---|---|---|
| Product sale | Product sale | Yes | Yes | **Yes** |
| Collection sale | Product sale | Yes | Yes | **Yes** |
| Tag sale | Vendor sale | Yes | Yes | **Yes** |
| Any sale | Any sale | No | Any | **No** |
| Any sale | Any sale | Yes | Non-overlapping | **No** |
| Sale ends at T=10 | Sale starts at T=10 | Yes | - | **No** (exact boundary allowed) |
| Whole store sale | Any | — | — | **N/A** (whole store creation blocked) |
| Sale | Same sale (update) | Yes | Yes | **No** (`excludeSaleId` used) |
| ACTIVE sale | New PENDING sale | Yes | Yes | **Yes** |
| COMPLETED sale | New sale | Any | Any | **No** (COMPLETED not in check) |

### 5. Risk Matrix

| Risk | Severity | Probability | Impact |
|---|---|---|---|
| `originalPrice=0` → prices set to $0 on revert | CRITICAL | Medium (requires mid-apply crash) | Price corruption, $0 products |
| Whole store targeting blocked | CRITICAL | High (any merchant tries it) | Feature broken, review risk |
| Sale ACTIVE but Shopify never updated | HIGH | Low-Medium | Revert corrupts prices |
| Completed sale reactivation is silent no-op | HIGH | High (common use case) | Broken workflow |
| `overrideCents` never applied | MEDIUM | High (any merchant uses it) | Feature mismatch |
| `excludeDrafts`/`excludeOnSale` not enforced | MEDIUM | High | Silent wrong behavior |
| Variants > 50 truncated | MEDIUM | Medium (large catalogs) | Partial sale application |
| Manual change detection false positives | MEDIUM | Low-Medium | Prices not restored |
| No shop/redact handler | HIGH | Certain (uninstall always fires) | GDPR risk, stuck prices |
| No cron → sales never activate | HIGH | Medium (env not configured) | System-wide failure |
| Partial apply on crash → discounted price stored as original | CRITICAL | Low (requires crash timing) | Permanent price corruption |

### 6. Shopify Review Risk Assessment

| Issue | Review Risk |
|---|---|
| Whole store targeting UI exists but is broken | **HIGH** — reviewer will test it |
| `originalPrice=0` can result in $0 products | **HIGH** — data integrity failure |
| No `shop/redact` webhook handler | **HIGH** — GDPR mandatory, Shopify checks this |
| `userErrors` from mutations not checked | **HIGH** — price operations must verify success |
| Reactivate button silently does nothing | **MEDIUM** — obvious UX failure |
| `overrideCents` shown in UI, not applied | **MEDIUM** — feature parity failure |
| `excludeDrafts`/`excludeOnSale` shown in UI, not applied | **MEDIUM** — feature parity failure |
| No retry/error surfacing on `applySale` partial failure | **MEDIUM** |

### 7. Recommended Fixes Before Re-Review

**Priority 1 — Must Fix**

1. **Implement Whole Store targeting** in `app.sales.new.jsx` action: add branch for `appliesToType === "all"` that paginates `products(first: 250)` globally (same pattern as tags/vendors).

2. **Fix `originalPrice=0` race**: change `createSale` to not create `SaleItem` rows with `originalPrice: 0`. Instead, only create `SaleItem` rows inside `applySale` after fetching real prices from Shopify. Or: add a pre-apply guard in `revertSale` that aborts if any `originalPrice === 0`.

3. **Add `shop/redact` webhook handler**: register and handle `shop/redact` — delete all `Sale`, `SaleItem`, `Timer`, `Coupon` records for the shop. Log compliance.

4. **Check `userErrors` in `productVariantsBulkUpdate` responses**: if errors returned, log them and do NOT mark the sale as `ACTIVE`.

5. **Fix reactivation of `COMPLETED` sales**: remove the guard `sale.status === "COMPLETED"` from `applySale`, or add a separate `reactivateSale` function that resets status to `PENDING` first, then calls `applySale`.

**Priority 2 — Fix for Feature Integrity**

6. **Apply `overrideCents` in `applySale`**: after computing `newPrice`, if `sale.overrideCents === true`, apply `Math.floor(newPrice) + 0.99`.

7. **Enforce `excludeDrafts` in `applySale`**: when fetching variants, also fetch `product.status`; skip variants where `status === "DRAFT"` if `sale.excludeDrafts` is true.

8. **Enforce `excludeOnSale` in `applySale`**: skip variants where `currentCompareAt !== null` if `sale.excludeOnSale` is true.

9. **Fix 50-variant truncation**: change `variants(first: 50)` to paginate variants per product, or use 250 (Shopify's max per page).

**Priority 3 — Robustness**

10. **Add `originalPrice === 0` guard in `revertSale`**: before restoring, check `if (item.originalPrice === 0) { console.error(...); continue; }` to prevent $0 restoration.

11. **Add rate limit retry**: wrap `admin.graphql` calls in a retry wrapper that checks for 429 responses and waits per `Retry-After` header.

12. **Handle `CRON_SECRET` misconfiguration more gracefully**: add monitoring/alerting rather than silent 500.

13. **Clean up deleted variant `SaleItem` rows**: in `revertSale`, after skipping a deleted variant, `await prisma.saleItem.delete({ where: { id: item.id } })`.

14. **Implement `tagsToAdd`/`tagsToRemove`**: apply Shopify product tag mutations in `applySale` and revert in `revertSale`, or remove the UI fields if not implemented.
