import { json } from "@remix-run/node";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { applySale, revertSale, checkItemOverlaps } from "../models/sale.server";
import { checkGlobalVariantLimitForShop } from "../models/billing.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret") || request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;
  
  if (!expectedSecret) {
    return json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  if (secret !== expectedSecret) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  
  // Find all sales to start (globally)
  const salesToStart = await prisma.sale.findMany({
    where: {
      status: "PENDING",
      startTime: { lte: now },
    },
    include: { items: true },
  });

  // Find all sales to end (globally)
  const salesToEnd = await prisma.sale.findMany({
    where: {
      status: "ACTIVE",
      endTime: { lte: now },
    },
  });

  const results = { started: [], ended: [], errors: [] };

  // Helper to get unauthenticated admin client per shop
  const adminClients = new Map();
  async function getAdminClient(shop) {
    if (adminClients.has(shop)) return adminClients.get(shop);
    try {
      const { admin } = await unauthenticated.admin(shop);
      adminClients.set(shop, admin);
      return admin;
    } catch (e) {
      console.error(`Failed to get admin client for ${shop}:`, e);
      return null;
    }
  }

  // Process starts
  for (const sale of salesToStart) {
    const admin = await getAdminClient(sale.shop);
    if (!admin) {
        results.errors.push(`Could not authenticate shop ${sale.shop} for sale ${sale.id}`);
        continue;
    }

    const variantIds = (sale.items || []).map(i => i.variantId);

    // 1. Check overlaps
    const overlapCheck = await checkItemOverlaps(sale.shop, variantIds, sale.id, sale.startTime, sale.endTime, sale.timerId);
    if (!overlapCheck.ok) {
        results.errors.push(`Overlap error for ${sale.id}: ${overlapCheck.message}`);
        continue;
    }

    // 2. Check billing limit
    const variantLimitCheck = await checkGlobalVariantLimitForShop(sale.shop, admin, variantIds, sale.startTime, sale.endTime, sale.id);
    if (!variantLimitCheck.ok) {
        results.errors.push(`Billing error for ${sale.id}: ${variantLimitCheck.message}`);
        continue;
    }

    try {
        await applySale(sale.id, admin);
        results.started.push(sale.id);
    } catch (e) {
        results.errors.push(`Apply error for ${sale.id}: ${e.message}`);
    }
  }

  // Process ends
  for (const sale of salesToEnd) {
    const admin = await getAdminClient(sale.shop);
    if (!admin) {
        results.errors.push(`Could not authenticate shop ${sale.shop} for sale ${sale.id}`);
        continue;
    }
    try {
        await revertSale(sale.id, admin);
        results.ended.push(sale.id);
    } catch (e) {
        results.errors.push(`Revert error for ${sale.id}: ${e.message}`);
    }
  }

  return json({
    success: true,
    startedCount: results.started.length,
    endedCount: results.ended.length,
    results
  });
}
