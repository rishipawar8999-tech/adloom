# Adloom — Shopify App Store Risk Audit
**Date:** 2026-05-28  
**Scope:** Business & operational risk only — not code quality  
**Source:** Direct codebase inspection, commit `34cebc9`  
**Auditor:** Runable AI

---

## Risk Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 5 |
| 🟠 High | 6 |
| 🟡 Medium | 4 |
| 🟢 Low | 2 |
| **Total** | **17** |

---

## 🔴 CRITICAL

---

### C-1 — Uninstall leaves merchant store permanently discounted

**Why it exists:**  
The `app.uninstalled` webhook only deletes the Shopify `Session` record. There is no call to `revertSale` or any price restoration before deletion. The `SHOP_REDACT` webhook (fires 48h later) only deletes remaining DB records — it does not call Shopify's price mutation API either.

**Merchant impact:**  
Any sale that was ACTIVE at the time of uninstall remains active on the live storefront — permanently. Products stay at discounted prices indefinitely. Merchant has no way to fix this from inside the app (app is gone) and may not notice for days or weeks.

**Shopify reviewer impact:**  
Direct violation of Shopify's [App Store requirements](https://shopify.dev/docs/apps/launch/app-requirements-checklist): apps must restore any data or storefront changes made during their operation upon uninstall. This is a **mandatory review requirement** and a common reason for app rejection or removal.

**Revenue impact:**  
Merchants whose stores are silently left discounted post-uninstall will churn immediately once discovered, and will leave 1-star reviews. Shopify can suspend the app listing if this surfaces during review or via merchant complaints.

**Suggested fix:**  
In `webhooks.app.uninstalled.js`, before deleting the session: query all ACTIVE sales for the shop, run `revertSale` for each, then delete session. Handle partial failures with logging. Do not rely on `SHOP_REDACT` as a cleanup mechanism — that webhook is data-deletion only.

---

### C-2 — `overrideCents` feature is entirely broken (UI lies to merchants)

**Why it exists:**  
`overrideCents` is a checkbox in the sale creation UI (`app.sales.new.jsx`), stored in the database, and visually demonstrated in the live price preview. However, `applySale` in `sale.server.js` never reads this field when computing final prices. The preview uses client-side logic; the actual Shopify mutation does not.

**Merchant impact:**  
Merchants explicitly configure "override cents to .99 / .00 / etc." believing their sale prices will end in specific cent values. Real storefront prices ignore this entirely. A merchant running a psychological pricing campaign (e.g., everything at $X.99) will have prices like $14.573 or $21.167 — depending on the discount — live on their store with no warning.

**Shopify reviewer impact:**  
Core advertised functionality that does not work. Shopify reviewers test listed features during review. If tested, this is grounds for rejection under the "app must function as described" policy.

**Revenue impact:**  
Merchants who test this feature will immediately distrust the app and churn. Negative reviews citing "features don't work" are hard to recover from on the App Store.

**Suggested fix:**  
Implement `overrideCents` logic inside `applySale` when computing `newPrice`. After computing the discounted price, apply the cent override rounding (e.g., floor to dollar + 0.99) before submitting to Shopify's price mutation. This must match the preview logic exactly.

---

### C-3 — `excludeDrafts` and `excludeOnSale` filters are non-functional

**Why it exists:**  
Both checkboxes exist in the UI and are persisted in the database. Neither is read during `applySale`. All products — including drafts and already-discounted items — are included in the sale regardless of these settings.

**Merchant impact:**  
- `excludeDrafts`: Unpublished/draft products get discounted prices pushed to them silently. If a merchant later publishes a draft, it launches at a discounted price with no active sale to revert it.  
- `excludeOnSale`: Merchants running stacked promotions expect items already on sale to be excluded. Instead, those items get double-discounted, potentially selling below cost.

**Shopify reviewer impact:**  
Same as C-2 — advertised filtering features that do not function as described. Multiple non-working features in the same flow compound the review risk significantly.

**Revenue impact:**  
Products sold below cost due to double-discounting is a direct financial loss to merchants. This creates high-severity support tickets, chargebacks, and legal exposure in markets with consumer pricing protection laws.

**Suggested fix:**  
In `applySale`, before adding a variant to the mutation batch: check `excludeDrafts` against `product.status === 'DRAFT'` and `excludeOnSale` against whether the current `compareAtPrice` is already set (indicating an existing sale). Skip variants that match the exclusion criteria.

---

### C-4 — Scheduled sales never activate without external infrastructure (no user warning)

**Why it exists:**  
`api.cron.js` requires an externally-triggered HTTP call with a valid `CRON_SECRET` environment variable to activate scheduled sales. `api.scheduler.js` runs only when the app is open in a merchant's browser. There is no fallback. If `CRON_SECRET` is not configured and an external cron caller is not set up, **no scheduled sale ever fires**.

**Merchant impact:**  
A merchant sets up a Flash Sale for Black Friday at midnight. They close the app tab. The sale never starts. They wake up to a normal-priced store, missed their promotional window, and have potentially already sent marketing emails to customers with discounted prices.

**Shopify reviewer impact:**  
Scheduled activation is a core feature of the app. If the app ships without this infrastructure configured, the feature is completely inoperative in production. Reviewers testing a scheduled sale will find it never fires.

**Revenue impact:**  
The entire value proposition of the app ("set it and forget it" sale automation) fails silently. This is the most likely cause of catastrophic churn if it hits production without the cron setup documented and verified.

**Suggested fix:**  
Either (a) use Shopify's built-in [App Cron / Scheduler](https://shopify.dev/docs/api/admin-graphql/latest/objects/AppSubscription) or a managed job queue (e.g., BullMQ backed by Redis) that doesn't depend on external secrets, or (b) add a startup check that logs a loud warning if `CRON_SECRET` is missing and block scheduled sale creation in the UI with a "Cron not configured" notice. Document the required deployment steps explicitly.

---

### C-5 — `tagsToAdd` / `tagsToRemove` are stored, shown in UI, and silently ignored

**Why it exists:**  
`app.sales.new.jsx` has full form fields for adding and removing product tags as part of a sale. These are stored in the database. Neither `applySale` nor `revertSale` in `sale.server.js` reads or applies these fields.

**Merchant impact:**  
Merchants using tags for inventory automation, loyalty triggers, or third-party integrations (e.g., Klaviyo segments, inventory tools) explicitly configure tag changes expecting them to fire. They don't. Merchants who rely on "sale" tags for storefront filtering will have those tags missing, breaking their theme's sale collection displays.

**Shopify reviewer impact:**  
Another case of non-functional advertised feature. Combined with C-2 and C-3, the pattern of multiple non-working features in the same primary flow is a strong signal for Shopify reviewers to flag the app.

**Revenue impact:**  
Merchants on higher-tier plans (Growth, Pro) likely use tags for automation. When automation breaks silently, blame typically goes to the most recently installed app. Churn and negative reviews follow.

**Suggested fix:**  
After `applySale` completes the price mutations, run a `tagsAdd` / `tagsRemove` GraphQL mutation for each affected product. In `revertSale`, reverse the tag operations. These should be idempotent (check tags exist before removing, etc.).

---

## 🟠 HIGH

---

### H-1 — "Whole Store" targeting crashes silently at creation

**Why it exists:**  
The sale creation form (`app.sales.new.jsx`) presents "Whole store" as a valid targeting option. The form action in `sale.server.js` validates items and returns `errors.items = "Please add at least one item to your sale"` when no items are resolved, which happens because there is no resolution logic for whole-store targeting.

**Merchant impact:**  
Merchant selects "Whole Store," fills in all other settings, clicks Create. The form submits, validation fires, and they get an error asking them to "add items" — but there's no items field to fill when "Whole Store" is selected. The UI is in a broken state with no path forward.

**Shopify reviewer impact:**  
A reviewer testing sale creation will immediately try "Whole Store" as it's the most common use case for a sale app. Finding it completely broken on the creation screen will likely result in immediate rejection.

**Revenue impact:**  
First-time user experience is destroyed at the most critical moment. Conversion from free trial to paid plan depends on merchants successfully creating their first sale. A broken creation flow = zero conversion.

**Suggested fix:**  
Either implement whole-store resolution (fetch all products for the shop, resolve all variants) or remove "Whole Store" from the UI until it's implemented. If removing, add a tooltip explaining it's "coming soon." Do not show a UI option for something that errors on use.

---

### H-2 — Reactivating a COMPLETED sale fires success toast but does nothing

**Why it exists:**  
The sale detail page (`app.sales.$id.jsx`) shows a "Reactivate" button for COMPLETED sales. The action handler calls `applySale`, which has a guard that returns early (`return`) when `sale.status === 'COMPLETED'`. The action still returns a success response, and the UI shows a success toast.

**Merchant impact:**  
Merchant believes they have reactivated a sale. No prices change. No status changes. The sale page continues to show COMPLETED. Merchant may spend time troubleshooting why products "aren't on sale" or, worse, trust the toast and send marketing emails about a sale that isn't live.

**Shopify reviewer impact:**  
A silent no-op that returns success is a UX violation. If a reviewer tests reactivation they will notice prices haven't changed while the app claims success.

**Revenue impact:**  
Merchant confusion leads to support tickets. Merchants who send marketing for a sale that isn't live will be significantly upset and likely leave reviews.

**Suggested fix:**  
Either remove the "Reactivate" button from COMPLETED sales (if not a supported feature), or implement proper reactivation logic (clone the sale to a new SCHEDULED/ACTIVE status). If reactivation is not intended, the button should either be absent or disabled with a tooltip explaining completed sales cannot be reactivated.

---

### H-3 — `originalPrice: 0` can corrupt product prices after a crash

**Why it exists:**  
`applySale` stores `originalPrice` in the database before mutating Shopify. If the server crashes after writing some `originalPrice: 0` records but before Shopify returns the actual prices, `revertSale` will restore those products to $0.00.

**Merchant impact:**  
After a server crash or timeout mid-sale-apply, some products on the live storefront may be set to $0.00 — free. Depending on the product and traffic levels, merchants could have significant revenue loss from free orders before noticing.

**Shopify reviewer impact:**  
Not directly testable during review, but the technical risk is severe enough that it's a significant liability for the app's long-term compliance status.

**Revenue impact:**  
$0 products processed as orders represent direct financial loss. Shopify does not automatically reverse completed orders. This is a potential support and legal escalation.

**Suggested fix:**  
Fetch and store actual `originalPrice` from Shopify's product data **before** any price mutations, not as a placeholder. Use a two-phase approach: (1) fetch all current prices and write to DB, (2) apply mutations. Never store `0` as an original price unless the product is actually free.

---

### H-4 — Plan downgrade can silently fail, leaving merchants over-quota

**Why it exists:**  
`webhooks.app.subscription_update.js` handles plan downgrades by deactivating excess sales. If the `admin` client is unavailable when the webhook fires (timing issue, token expiry), the handler returns HTTP 200 silently without taking action. Shopify considers the webhook delivered.

**Merchant impact:**  
A merchant downgrades from Growth to Basic. Their excess active sales remain live. They continue receiving discounts beyond what their plan allows with no notification. This is both a financial loss to the business and a merchant expectation mismatch.

**Shopify reviewer impact:**  
Billing integrity is a hard requirement for Shopify App Store compliance. If merchants retain paid features after downgrading, Shopify can suspend the app for billing violations.

**Revenue impact:**  
Direct revenue loss: merchants who downgrade still consume Growth-tier resources. At scale, this becomes material. Worse, if merchants discover they're getting Growth features on Basic, they have no incentive to upgrade.

**Suggested fix:**  
Add retry logic or a job queue for downgrade processing. If the webhook cannot be processed immediately, persist a "pending downgrade" record and process it on the next authenticated request. Never return 200 without confirming the downgrade was applied or queued.

---

### H-5 — `userErrors` from Shopify mutations are not checked; sales marked ACTIVE on failure

**Why it exists:**  
The `applySale` function submits price mutations to Shopify's GraphQL API but does not check the `userErrors` array in the response. Shopify can reject a mutation (e.g., for a product that was deleted, archived, or has a conflicting price rule) while still returning HTTP 200. The sale is marked ACTIVE regardless.

**Merchant impact:**  
A merchant activates a sale and sees it as ACTIVE in the app. Some or all products are not actually discounted on the storefront. The merchant has no way to know which products failed without manually checking each one.

**Shopify reviewer impact:**  
Error handling for Shopify API mutations is expected in production-ready apps. A sale that reports ACTIVE while products are not actually discounted is a reliability failure.

**Revenue impact:**  
Merchants who run promotions trusting the ACTIVE status without verifying storefront prices will have under-discounted sales. When customers notice discrepancies, the merchant blames the app. Churn and negative reviews follow.

**Suggested fix:**  
After each `productVariantsBulkUpdate` mutation, check `response.userErrors`. If errors exist, collect the failed variant IDs, log them, and surface a warning in the UI ("X variants could not be updated"). Consider marking the sale as `ACTIVE_WITH_ERRORS` and displaying affected products.

---

### H-6 — Coupon validation bypass creates invalid coupons

**Why it exists:**  
`app.coupons.new.jsx` includes a `forceSave=true` flag that skips Shopify discount code validation. This means coupons can be created in the app's database that reference discount codes which don't actually exist in Shopify.

**Merchant impact:**  
Merchants can create and distribute coupon codes that return errors at checkout. Customers attempting to use the code during a promotion get "invalid coupon" errors. This is a direct customer-facing failure at the highest-intent moment in the funnel.

**Shopify reviewer impact:**  
The bypass mechanism suggests awareness that validation fails in certain cases. Shipping known-broken coupons is a UX and reliability concern that reviewers may flag.

**Revenue impact:**  
Failed coupon codes during promotions = abandoned carts, customer support escalations, and brand trust damage. For merchants running paid campaigns tied to a coupon, this can represent significant wasted ad spend.

**Suggested fix:**  
Remove the `forceSave` bypass or restrict it to explicit admin/debug mode behind a feature flag. Always validate that a discount code exists in Shopify before persisting a coupon record. If Shopify validation fails, return the error to the merchant with a clear explanation.

---

## 🟡 MEDIUM

---

### M-1 — 50-variant truncation silently drops products from sales

**Why it exists:**  
Product variant queries in collection/tag/vendor targeting use a hardcoded `first: 50` limit. Products with more than 50 variants (e.g., apparel with many size/color combinations) have variants beyond the 50th silently excluded from the sale.

**Merchant impact:**  
Large-catalog merchants (fashion, accessories) running sales on collections or tags will have incomplete sales. Some variants will be full-price on the storefront while others are discounted, with no indication in the app.

**Shopify reviewer impact:**  
Medium risk during review — reviewers testing with small catalogs won't hit this. Risk surfaces after launch via merchant reports.

**Revenue impact:**  
Merchants with large variant counts will see inconsistent storefronts. Customer confusion and support tickets. Likely unnoticed until a merchant with a large catalog tries the app.

**Suggested fix:**  
Implement pagination using Shopify's `pageInfo.hasNextPage` + `after` cursor for all variant queries. Process all pages before building the mutation batch.

---

### M-2 — Sale targets are snapshot-based, UI implies dynamic behavior

**Why it exists:**  
When a sale is created targeting a collection, tag, or vendor, the app resolves matching products at creation time and stores a snapshot. Products added to that collection/tag after sale creation are never included, even for ACTIVE sales.

**Merchant impact:**  
A merchant creates a "Summer Collection Sale" then adds new products to the Summer collection. Those products are full-price while all others are discounted. The merchant assumes the sale is dynamic (because they targeted a collection, not individual products) and doesn't understand why new products are excluded.

**Shopify reviewer impact:**  
The UI doesn't communicate that targeting is snapshotted at creation. This is a UX transparency issue. Reviewers checking app accuracy may flag this.

**Revenue impact:**  
Merchant confusion and support overhead. Not a direct revenue threat but erodes trust in the product's reliability.

**Suggested fix:**  
Either implement dynamic resolution (re-evaluate collection/tag/vendor membership on each activation or on a schedule), or clearly communicate in the UI that "This sale applies to products matching these rules at the time of creation" and show the resolved product count at creation time.

---

### M-3 — `Advanced Analytics` listed on pricing page but feature does not exist

**Why it exists:**  
`app.pricing.jsx` lists "Advanced Analytics" as a Growth plan feature. There is no analytics route, no analytics model, and no analytics data collection anywhere in the codebase.

**Merchant impact:**  
Merchants upgrade to Growth expecting analytics. The feature is not present. This is a false advertising claim on a paid plan.

**Shopify reviewer impact:**  
Shopify requires that all features listed in the app's pricing and marketing materials actually exist and function. Listing non-existent features on a paid plan is a direct violation of App Store policies and grounds for rejection or removal.

**Revenue impact:**  
Merchants who upgrade specifically for analytics will immediately downgrade or churn when they find it missing. Potential for refund requests. Reputational risk if this surfaces publicly.

**Suggested fix:**  
Remove "Advanced Analytics" from the Growth plan listing immediately, or replace with a "coming soon" badge. Do not list unbuilt features as active plan benefits on paid tiers.

---

### M-4 — Timer widget continues showing after sale ends (60-second cache)

**Why it exists:**  
`app.proxy.js` returns `Cache-Control: private, max-age=60` on the timer endpoint. When a sale ends, the countdown widget on the merchant's storefront continues showing (and potentially counting down below zero) for up to 60 seconds.

**Merchant impact:**  
Customers may see a "Sale ends in 0:00:45" timer after the sale has already ended and prices reverted. If a customer adds to cart based on the displayed timer and then sees full price at checkout, it creates a trust-damaging experience.

**Shopify reviewer impact:**  
Low review risk — unlikely to be caught in a short review window. But a 60-second stale countdown is a customer-facing UX defect.

**Revenue impact:**  
Misleading timers post-sale expiry can create customer service issues and potential Shopify merchant disputes if customers claim they were shown a sale price that wasn't honored.

**Suggested fix:**  
Reduce cache TTL to 5-10 seconds for the timer endpoint, or use `Cache-Control: no-store` for the final 60 seconds before sale expiry. Alternatively, have the client-side widget detect when the countdown hits zero and immediately re-fetch rather than relying on the cache.

---

## 🟢 LOW

---

### L-1 — `BILLING_TEST_MODE` may silently disable real charges in production

**Why it exists:**  
`app.pricing.jsx` and billing logic enable test mode when `NODE_ENV !== "production"` OR when an explicit `BILLING_TEST_MODE` env var is set. If either condition is incorrectly set in a production deployment, all billing operates in Shopify's test mode — no real charges are made.

**Merchant impact:**  
None visible to merchants — they get the app for free. App loses revenue silently.

**Shopify reviewer impact:**  
Not a review risk. Shopify will accept the app regardless.

**Revenue impact:**  
If misconfigured in production, the app earns $0 in subscription revenue. This is primarily an operational/deployment risk. Would only be discovered when reconciling Shopify Partner payouts vs. expected revenue.

**Suggested fix:**  
Add a startup assertion: if `NODE_ENV === "production"` and `BILLING_TEST_MODE` is set, log a loud warning (or throw an error) so it's caught during deployment. Separate the two conditions — production should never accept `BILLING_TEST_MODE` without explicit override.

---

### L-2 — `Custom Offer Designs` and `White-glove Setup` on Pro plan are undefined

**Why it exists:**  
`app.pricing.jsx` lists these as Pro plan features. "White-glove setup" is not a product feature — it's a service that requires defined scope, delivery process, and staffing. "Custom Offer Designs" has no corresponding UI, admin tooling, or customization surface in the codebase.

**Merchant impact:**  
Pro plan merchants paying the highest tier expect these features to be available. If not delivered, this is a breach of the subscription offer.

**Shopify reviewer impact:**  
Same risk as M-3 — listing non-functional or undefined features on paid plans is an App Store policy violation. Lower urgency than M-3 since "white-glove" is interpretable as a manual service, but needs to be defined.

**Revenue impact:**  
If Pro plan pricing is justified partly by these features, and merchants who signed up for them churn when they find them undefined, this is a revenue and reputation risk at the highest-value customer tier.

**Suggested fix:**  
Define "White-glove Setup" explicitly (e.g., "Onboarding call with our team") and create a delivery mechanism (calendar link, email trigger on Pro subscription). For "Custom Offer Designs" — either build it or remove it from the pricing page until it exists.

---

## Risk Matrix Summary

| ID | Issue | Severity | Shopify Review Risk | Revenue Risk |
|----|-------|----------|---------------------|--------------|
| C-1 | Uninstall leaves prices discounted | 🔴 Critical | Rejection / Removal | Churn + reviews |
| C-2 | `overrideCents` broken end-to-end | 🔴 Critical | Rejection | Churn |
| C-3 | `excludeDrafts` / `excludeOnSale` non-functional | 🔴 Critical | Rejection | Sell-below-cost |
| C-4 | Scheduled sales never fire without cron setup | 🔴 Critical | Rejection | Core feature failure |
| C-5 | Tag mutations stored, never applied | 🔴 Critical | Rejection | Automation breakage |
| H-1 | Whole Store targeting crashes at creation | 🟠 High | Rejection | Zero conversion |
| H-2 | Reactivate COMPLETED sale: silent no-op + success toast | 🟠 High | Flag | Support tickets |
| H-3 | `originalPrice: 0` crash = $0 products | 🟠 High | — | Direct revenue loss |
| H-4 | Plan downgrade silent failure | 🟠 High | Suspension | Revenue leakage |
| H-5 | Shopify `userErrors` ignored, sale marked ACTIVE | 🟠 High | Flag | Trust / churn |
| H-6 | Coupon bypass creates invalid codes | 🟠 High | Flag | Cart abandonment |
| M-1 | 50-variant truncation | 🟡 Medium | — | Incomplete sales |
| M-2 | Snapshot targeting vs. implied dynamic | 🟡 Medium | Flag | Confusion |
| M-3 | Advanced Analytics listed, doesn't exist | 🟡 Medium | Rejection | Upgrade churn |
| M-4 | Timer shows 60s after sale ends | 🟡 Medium | — | Customer trust |
| L-1 | `BILLING_TEST_MODE` in production | 🟢 Low | — | Silent $0 revenue |
| L-2 | Undefined Pro plan features | 🟢 Low | Flag | High-tier churn |

---

## Recommended Fix Order

**Before any App Store submission:**
1. C-1 — Fix uninstall webhook (reverting prices on uninstall is a hard Shopify requirement)
2. C-4 — Verify cron infrastructure or implement Shopify-native scheduling
3. H-1 — Remove or implement "Whole Store" targeting
4. M-3 — Remove non-existent "Advanced Analytics" from pricing page
5. C-2, C-3, C-5 — Implement the stored-but-ignored sale settings

**Before launch (post-submission window):**
6. H-5 — Check `userErrors` on all Shopify mutations
7. H-4 — Add downgrade retry/queue logic
8. H-3 — Fix `originalPrice` pre-fetch to avoid $0 crash
9. H-2 — Fix or remove "Reactivate" on COMPLETED sales
10. H-6 — Remove coupon validation bypass

**Post-launch / roadmap:**
11. M-1 — Paginate variant queries
12. M-2 — Clarify snapshot behavior in UI
13. M-4 — Reduce timer cache TTL
14. L-1 — Add production billing mode assertion
15. L-2 — Define and deliver Pro plan features

---

*End of Audit — 17 issues across 8 categories*
