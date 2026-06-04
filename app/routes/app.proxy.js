import { json } from "@remix-run/node";

export async function loader({ request }) {
  const { authenticate } = await import("../shopify.server");
  const db = (await import("../db.server")).default;
  const { session } = await authenticate.public.appProxy(request);
  const shop = session.shop;
  
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const rawProductId = url.searchParams.get("productId");

  console.log(`[Proxy Request] shop=${shop}, type=${type}, productId=${rawProductId}`);
  if (!rawProductId) {
    return json({ error: "Missing productId" }, { status: 400 });
  }

  const now = new Date();
  const responseData = { serverTime: now.toISOString() };
  const variantId = url.searchParams.get("variantId") || "";
  const gid = rawProductId.startsWith("gid://") ? rawProductId : `gid://shopify/Product/${rawProductId}`;
  const numericId = rawProductId.replace("gid://shopify/Product/", "");

  // --- Coupon Offers ---
  if (type === "coupons") {
    const tags = url.searchParams.get("tags") || "";
    const vendor = url.searchParams.get("vendor") || "";
    const collections = url.searchParams.get("collections") || "";
    
    const { getCouponsForProduct } = await import("../models/coupon.server");
    const coupons = await getCouponsForProduct(gid, { tags, vendor, collections }, shop);

    responseData.coupons = coupons.map((c) => ({
      offerTitle: c.offerTitle,
      couponCode: c.couponCode,
      description: c.description,
      style: c.style,
    }));

    return json(responseData, {
      headers: { "Cache-Control": "private, max-age=5" }
    });
  }

  // --- Timer (default) ---
  const sales = await db.sale.findMany({
    where: {
      shop,
      status: "ACTIVE",
      startTime: { lte: now },
      endTime: { gte: now },
      items: {
        some: {
          AND: [
            { OR: [{ productId: gid }, { productId: numericId }] },
            variantId ? { variantId } : {}
          ]
        },
      },
    },
    include: {
      timer: true,
    },
  });

  const activeSale = sales[0];
  if (activeSale) {
    responseData.timer = {
       ...(activeSale.timer || {}),
       hasTimer: activeSale.timer ? (() => {
           try {
               const style = JSON.parse(activeSale.timer.style);
               return style.showClock !== false;
           } catch (e) {
               return true;
           }
       })() : false,
       endTime: activeSale.endTime, // Always pass endTime just in case, but frontend checks hasTimer
       // Fallbacks if no timer is attached
       title: activeSale.timer ? activeSale.timer.name : activeSale.title,
       style: activeSale.timer ? activeSale.timer.style : JSON.stringify({
           backgroundColor: "#000000",
           titleColor: "#ffffff",
           timerColor: "#ffffff",
           labels: { days: "D", hours: "H", minutes: "M", seconds: "S" }
       })
    };
  } else {
    responseData.timer = null;
  }

  return json(responseData, {
    headers: { "Cache-Control": "private, max-age=5" }
  });
}
