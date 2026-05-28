export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const db = (await import("../db.server")).default;
  
  try {
    const { topic, shop, session } = await authenticate.webhook(request);
    console.log(`[Webhook] Received ${topic} for shop ${shop}`);

    switch (topic) {
      case "APP_UNINSTALLED":
        // Only delete the session, NOT the merchant's data.
        // Shopify sends SHOP_REDACT 48h later if they don't reinstall.
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
        break;

      case "SHOP_REDACT":
        // Shopify sends this 48h after uninstall if merchant hasn't reinstalled.
        // This is the correct time to permanently delete all data.
        console.log(`[GDPR] Deleting all data for shop: ${shop}`);
        await db.sale.deleteMany({ where: { shop } });
        await db.coupon.deleteMany({ where: { shop } });
        await db.timer.deleteMany({ where: { shop } });
        await db.session.deleteMany({ where: { shop } });
        break;

      case "CUSTOMERS_DATA_REQUEST":
      case "CUSTOMERS_REDACT":
        // Our app stores no personal customer data (only product/variant IDs).
        console.log(`[GDPR] Processing ${topic} for ${shop}. No personal data stored.`);
        break;
        
      default:
        console.log(`[Webhook] Unhandled topic: ${topic}`);
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(`[Webhook] Error handling webhook:`, error);
    return new Response("Webhook error", { status: 500 });
  }
};
