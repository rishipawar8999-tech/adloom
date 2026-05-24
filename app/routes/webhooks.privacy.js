export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const db = (await import("../db.server")).default;
  
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);
    console.log(`[Privacy Webhook] Received ${topic} for shop ${shop}`);

    switch (topic) {
      // ── Shop Redact ────────────────────────────────────────────────────────
      // Shopify sends this 48 hours after uninstall IF the merchant has NOT reinstalled.
      // This is the correct time to permanently delete all of the shop's data.
      case "SHOP_REDACT": {
        console.log(`[Privacy] Deleting all data for uninstalled shop: ${shop}`);
        await db.sale.deleteMany({ where: { shop } });
        await db.coupon.deleteMany({ where: { shop } });
        await db.timer.deleteMany({ where: { shop } });
        await db.session.deleteMany({ where: { shop } });
        console.log(`[Privacy] All data deleted for shop: ${shop}`);
        break;
      }

      // ── Customer Data Request ──────────────────────────────────────────────
      // A customer requested an export of their data from the merchant's store.
      // Our app stores no personal customer data — we only store product/variant IDs.
      case "CUSTOMERS_DATA_REQUEST": {
        const customerId = payload?.customer?.id;
        console.log(`[Privacy] Customer data request for customer ${customerId} in shop ${shop}. No personal data stored.`);
        break;
      }

      // ── Customer Redact ────────────────────────────────────────────────────
      // A customer requested erasure of their data from the merchant's store.
      // Our app stores no personal customer data — safe to acknowledge immediately.
      case "CUSTOMERS_REDACT": {
        const customerId = payload?.customer?.id;
        console.log(`[Privacy] Customer redact request for customer ${customerId} in shop ${shop}. No personal data stored.`);
        break;
      }

      default:
        console.log(`[Privacy] Unhandled topic: ${topic}`);
    }

    return new Response("Webhook processed", { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(`[Privacy Webhook] Error handling webhook:`, error);
    return new Response("Error processing webhook", { status: 500 });
  }
};
