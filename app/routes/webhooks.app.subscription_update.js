import { authenticate } from "../shopify.server";
import db from "../db.server";
import { revertSale } from "../models/sale.server";
import { PLAN_LIMITS, getPlanWithAdmin } from "../models/billing.server";

export const action = async ({ request }) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);

  if (topic !== "APP_SUBSCRIPTIONS_UPDATE") {
    return new Response("Invalid topic", { status: 400 });
  }

  console.log(`[Webhook] Received APP_SUBSCRIPTIONS_UPDATE for ${shop}`);

  if (!admin) {
    console.error("No admin client available in webhook. Cannot reconcile sales.");
    // We strictly need admin to run mutations (revertSale). 
    return new Response("No admin client", { status: 200 });
  }

  try {
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
    } else {
        // Fallback: Fetch from Shopify if payload is incomplete
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

    for (const sale of salesToDeactivate) {
        console.log(`[Billing] Deactivating sale ${sale.id} due to downgrade.`);
        try {
            await revertSale(sale.id, admin);
        } catch (err) {
            console.error(`Failed to auto-revert sale ${sale.id}`, err);
        }
    }

    return new Response("Reconciled", { status: 200 });

  } catch (error) {
    console.error("Error in subscription webhook:", error);
    return new Response("Webhook failed", { status: 500 });
  }
};
