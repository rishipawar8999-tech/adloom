import prisma from "./db.server";
import { unauthenticated } from "./shopify.server";
import { applySale, revertSale, checkItemOverlaps } from "./models/sale.server";
import { checkGlobalVariantLimitForShop } from "./models/billing.server";

export async function runCronTasks() {
  const now = new Date();
  
  // Track cron execution
  await prisma.systemState.upsert({
    where: { id: "singleton" },
    update: { lastCron: now },
    create: { id: "singleton", lastCron: now }
  });
  
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

  const results = { started: [], ended: [], errors: [], downgrades: 0 };

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

  // Process pending downgrades
  const pendingDowngrades = await prisma.pendingDowngrade.findMany();
  for (const pd of pendingDowngrades) {
    const admin = await getAdminClient(pd.shop);
    if (!admin) continue; // Still no admin, keep pending
    
    try {
      const PLAN_LIMITS = {
        Free: { maxSales: 1 },
        Basic: { maxSales: 5 },
        Growth: { maxSales: Infinity },
        Pro: { maxSales: Infinity }
      };
      const limits = PLAN_LIMITS[pd.plan] || PLAN_LIMITS.Free;
      
      if (limits.maxSales !== Infinity) {
          const activeSales = await prisma.sale.findMany({
              where: { shop: pd.shop, status: "ACTIVE" },
              orderBy: { createdAt: "desc" },
          });

          if (activeSales.length > limits.maxSales) {
              const salesToRevert = activeSales.slice(limits.maxSales);
              for (const sale of salesToRevert) {
                  await revertSale(sale.id, admin);
              }
          }
      }
      
      // Cleanup pending downgrade
      await prisma.pendingDowngrade.delete({ where: { id: pd.id } });
      results.downgrades = (results.downgrades || 0) + 1;
    } catch (e) {
      results.errors.push(`Downgrade error for ${pd.shop}: ${e.message}`);
    }
  }

  return results;
}
