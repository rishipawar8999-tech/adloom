import { authenticate } from "../shopify.server";
import db from "../db.server";
import { revertSale } from "../models/sale.server";
import { PLAN_LIMITS, getPlanWithAdmin } from "../models/billing.server";

export const action = async ({ request }) => {
  try {
  const { topic, shop, payload, admin: authAdmin } = await authenticate.webhook(request);
  let admin = authAdmin;

  if (topic !== "APP_SUBSCRIPTIONS_UPDATE") {
    return new Response("Invalid topic", { status: 400 });
  }

  console.log(`[Webhook] Received APP_SUBSCRIPTIONS_UPDATE for ${shop}`);

  // 1. Determine Plan from Payload (Primary)
  let plan = "Free";
  if (payload.app_installation && payload.app_installation.active_subscriptions) {
      const activeSub = payload.app_installation.active_subscriptions.find(s => s.status === "ACTIVE");
      if (activeSub) {
          const name = activeSub.name.toLowerCase();
          if (name.includes("pro")) plan = "Pro";
          else if (name.includes("growth")) plan = "Growth";
          else if (name.includes("basic")) plan = "Basic";
      }
  }

  if (!admin) {
    console.log(`[Webhook] No admin client available for ${shop}. Falling back to offline token.`);
    try {
      const { unauthenticated } = await import("../shopify.server");
      const offlineSession = await unauthenticated.admin(shop);
      admin = offlineSession.admin;
    } catch (e) {
      console.error(`[Webhook] Failed to load offline admin for ${shop}:`, e);
    }
    
    if (!admin) {
      console.error(`[Webhook] Still no admin client for ${shop}. Queueing pending downgrade to ${plan}.`);
      const db = (await import("../db.server")).default;
      await db.pendingDowngrade.create({ data: { shop, plan } });
      return new Response("Queued pending downgrade", { status: 200 });
    }
  }

  try {
    // Fallback: Fetch from Shopify if payload is incomplete
    if (!payload.app_installation) {
        const result = await getPlanWithAdmin(admin);
        plan = result.plan || "Free";
    }
    
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.Free;
    console.log(`[Billing] Shop ${shop} is now on ${plan} plan. Limit: ${limits.maxSales} active sales.`);

    if (limits.maxSales === Infinity) {
        return new Response("Plan has infinite limits", { status: 200 });
    }

    // 2. Count Active Sales
    const activeSales = await db.sale.findMany({
        where: { shop, status: "ACTIVE" },
        // Deactivate NEWEST active sales first (keep established rules running for as long as possible?)
        // Or deactivate OLDEST? 
        // Logic: The user just downgraded. They probably want their "best" sales to keep running. 
        // But we don't know which are best. 
        // Let's assume LIFO (Last In First Out) for deactivation -> Deactivate the most recently created ones.
        orderBy: { createdAt: "desc" } 
    });

    if (activeSales.length <= limits.maxSales) {
        return new Response("Limits within range", { status: 200 });
    }

    // 3. Deactivate Excess Sales
    const excessCount = activeSales.length - limits.maxSales;
    console.warn(`[Billing] Shop ${shop} has ${activeSales.length} sales, limit is ${limits.maxSales}. Deactivating ${excessCount} excess sales.`);
    
    const salesToDeactivate = activeSales.slice(0, excessCount);

    let revertedCount = 0;
    let failedCount = 0;

    for (const sale of salesToDeactivate) {
        console.log(`[Billing] Deactivating sale ${sale.id} due to plan downgrade.`);
        try {
            await revertSale(sale.id, admin);
            revertedCount++;
            console.log(`[Billing] Successfully reverted sale ${sale.id}.`);
        } catch (err) {
            failedCount++;
            console.error(`[Billing] Sale revert failed for sale ${sale.id} (Shopify API error — will not retry): ${err?.message ?? err}`);
        }
    }

    if (failedCount > 0) {
        console.warn(`[Billing] Reconciliation completed with errors for shop ${shop}: ${revertedCount} reverted, ${failedCount} failed. Returning 200 to prevent webhook retry storm.`);
    } else {
        console.log(`[Billing] Reconciliation complete for shop ${shop}: ${revertedCount} sale(s) reverted.`);
    }

    return new Response("Reconciled", { status: 200 });

  } catch (error) {
    console.error(`[Webhook] Unexpected error processing APP_SUBSCRIPTIONS_UPDATE for shop ${shop}:`, error);
    return new Response("Webhook processing failed", { status: 200 });
  }

  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(`[Webhook] Error handling webhook:`, error);
    return new Response("Webhook error", { status: 500 });
  }
};
