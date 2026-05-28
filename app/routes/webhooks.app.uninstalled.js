export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const db = (await import("../db.server")).default;

  try {
    const { shop, session, topic } = await authenticate.webhook(request);

    console.log(`[Webhook] Received ${topic} for ${shop}`);

    // ─── IMPORTANT: Only delete the session, NOT the merchant's data ───────────
    // Shopify sends `shop/redact` 48 hours AFTER uninstall (only if not reinstalled).
    // That is the correct and compliant time to delete sales, coupons, and timers.
    // Deleting everything here means reinstalling merchants lose all their work.
    // ──────────────────────────────────────────────────────────────────────────
    if (session) {
      try {
        const { unauthenticated } = await import("../shopify.server");
        const { admin } = await unauthenticated.admin(shop);
        const { revertSale } = await import("../models/sale.server");
        
        const activeSales = await db.sale.findMany({
          where: { shop, status: "ACTIVE" }
        });
        
        for (const sale of activeSales) {
          try {
            console.log(`[Webhook] Attempting to revert active sale ${sale.id} on uninstall`);
            await revertSale(sale.id, admin);
          } catch (e) {
            console.warn(`[Webhook] Failed to revert sale ${sale.id} during uninstall. Token likely revoked.`, e);
          }
        }
      } catch (e) {
        console.warn(`[Webhook] Could not load admin context for uninstall revert.`, e);
      }

      await db.session.deleteMany({ where: { shop } });
    }

    return new Response();
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(`[Webhook] Error handling webhook:`, error);
    return new Response("Webhook error", { status: 500 });
  }
};
