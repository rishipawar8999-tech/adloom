import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const PLAN_LIMITS = {
  Free: { sales: 1, coupons: 2, timers: 1 },
  Basic: { sales: 5, coupons: 5, timers: 5 },
  Growth: { sales: 20, coupons: 20, timers: 20 },
  Pro: { sales: Infinity, coupons: Infinity, timers: Infinity },
};

export async function getPlan(request) {
  const { admin } = await authenticate.admin(request);
  
  try {
    const response = await admin.graphql(`
      query getSubscriptions {
        appInstallation {
          activeSubscriptions {
            name
            status
          }
        }
      }
    `);

    const data = await response.json();
    const subscriptions = data?.data?.appInstallation?.activeSubscriptions || [];
    const activeSub = subscriptions.find(sub => sub.status === "ACTIVE");
    
    if (!activeSub) return "Free";

    return activeSub.name;
  } catch (error) {
    console.error("Error fetching plan via GraphQL:", error);
    return "Free";
  }
}

export async function getPlanUsage(request) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const plan = await getPlan(request);
  const basePlan = plan.replace(" Annual", "");
  const limits = PLAN_LIMITS[basePlan] || PLAN_LIMITS.Free;

  // Count active resources
  const activeSales = await prisma.sale.count({
    where: { shop, status: "ACTIVE" },
  });

  const activeCoupons = await prisma.coupon.count({
    where: {
      shop,
      status: "ACTIVE",
      endTime: { gt: new Date() },
    },
  });

  const activeTimers = await prisma.timer.count({
    where: { shop }
  });

  return {
    plan,
    sales: { used: activeSales, limit: limits.sales },
    coupons: { used: activeCoupons, limit: limits.coupons },
    timers: { used: activeTimers, limit: limits.timers },
  };
}

export async function checkLimit(request, feature) {
  const usage = await getPlanUsage(request);
  const resourceUsage = usage[feature]; // feature: 'sales', 'coupons', 'timers'

  if (!resourceUsage) return true;

  if (resourceUsage.limit === Infinity) return true;

  if (resourceUsage.used >= resourceUsage.limit) {
    return false;
  }

  return true;
}
