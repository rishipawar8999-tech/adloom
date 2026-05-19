import db from "../db.server";

/**
 * Validates if a discount code exists and is active in Shopify.
 * @param {string} code - The code to check
 * @param {object} admin - The Shopify Admin GraphQL client
 * @returns {object} { ok: boolean, message?: string }
 */
export async function validateShopifyDiscount(code, admin) {
  if (!code) return { ok: false, message: "Discount code is required." };

  const query = `
    query getDiscountCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            status
            title
          }
          ... on DiscountCodeBuyXGetY {
            status
            title
          }
          ... on DiscountCodeFreeShipping {
            status
            title
          }
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(query, { variables: { code } });
    const { data } = await response.json();
    
    const node = data?.codeDiscountNodeByCode;
    
    if (!node) {
      // Try again with uppercase just in case
      const upperResponse = await admin.graphql(query, { variables: { code: code.toUpperCase() } });
      const { data: upperData } = await upperResponse.json();
      if (!upperData?.codeDiscountNodeByCode) {
        return { ok: false, message: "This discount code was not found in Shopify. Create it in Shopify first, then add it here." };
      }
      return { ok: true };
    }


    // Check status
    const status = node.codeDiscount?.status;
    if (status === "EXPIRED") {
       return { ok: false, message: "This discount code has expired in Shopify." };
    }
    
    if (status !== "ACTIVE" && status !== "SCHEDULED") {
        return { ok: false, message: `This discount code is currently ${status.toLowerCase()} in Shopify.` };
    }
    
    return { ok: true };
  } catch (error) {
    console.error("[CouponValidation] Internal Error:", error);
    return { 
        ok: false, 
        isVerificationError: true,
        message: "Adloom could not verify this code with Shopify right now. You can still save it, but please confirm the code exists in Shopify before showing it to customers." 
    }; 
  }
}




export async function getCoupons(shop) {
  return db.coupon.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    include: { products: true },
  });
}

export async function getCoupon(id, shop) {
  const coupon = await db.coupon.findUnique({
    where: { id },
    include: { products: true },
  });
  if (!coupon) return null;
  if (shop && coupon.shop !== shop) return null;
  return coupon;
}

export async function deleteCoupon(id, shop) {
  const coupon = await getCoupon(id, shop);
  if (!coupon) return;
  await db.couponProduct.deleteMany({ where: { couponId: id } });
  return db.coupon.delete({ where: { id } });
}

export async function createCoupon(data, shop) {
  if (!shop) throw new Error("Shop is required");
  const { products, ...couponData } = data;
  
  const selection = products;
  const productItems = selection.type === "products" ? selection.products : [];

  return db.coupon.create({
    data: {
      ...couponData,
      shop,
      priority: parseInt(couponData.priority) || 0,
      startTime: new Date(couponData.startTime),
      endTime: new Date(couponData.endTime),
      products: {
        create: productItems.map((p) => ({
          productId: p.productId,
        })),
      },
    },
  });
}

export async function updateCoupon(id, data, shop) {
  const coupon = await getCoupon(id, shop);
  if (!coupon) throw new Error("Unauthorized or Not Found");

  const { products, shop: _shop, ...couponData } = data;
  const selection = products;
  const productItems = selection.type === "products" ? selection.products : [];

  // Delete existing product associations
  await db.couponProduct.deleteMany({
    where: { couponId: id },
  });

  return db.coupon.update({
    where: { id },
    data: {
      ...couponData,
      priority: parseInt(couponData.priority) || 0,
      startTime: new Date(couponData.startTime),
      endTime: new Date(couponData.endTime),
      products: {
        create: productItems.map((p) => ({
          productId: p.productId,
        })),
      },
    },
  });
}

export async function getCouponsForProduct(productId, productData = {}, shop) {
  const now = new Date();
  const allCoupons = await db.coupon.findMany({
    where: {
      shop,
      status: "ACTIVE",
      startTime: { lte: now },
      endTime: { gte: now },
    },
    include: { products: true },
  });

  // Sort by priority (lower first), then by newest
  return allCoupons.filter((coupon) => {
    let style;
    try {
      style = JSON.parse(coupon.style || "{}");
    } catch {
      style = {};
    }

    const isProductMatch = coupon.products.some((p) => p.productId === productId);
    if (isProductMatch) return true;

    const selection = style.selection || {};
    if (selection.type === "all") return true;
    
    if (selection.type === "tags" && productData.tags) {
      const productTags = productData.tags.split(",").map(t => t.trim().toLowerCase());
      return selection.tags.some(tag => productTags.includes(tag.toLowerCase()));
    }

    if (selection.type === "vendors" && productData.vendor) {
      return (selection.vendors || []).some(v => v.toLowerCase() === productData.vendor.toLowerCase());
    }

    if (selection.type === "collections" && productData.collections) {
      const productCollectionIds = productData.collections.split(",").map(id => id.trim());
      return (selection.collections || []).some((c) => {
        const numericId = String(c.id).replace("gid://shopify/Collection/", "");
        return productCollectionIds.includes(numericId);
      });
    }
    
    return false;
  }).sort((a, b) => {
    // Sort by priority ascending (lower = higher priority)
    const pA = a.priority || 0;
    const pB = b.priority || 0;
    if (pA !== pB) return pA - pB;
    // Then by newest first
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

export async function updateCouponPriority(id, priority, shop) {
  const coupon = await getCoupon(id, shop);
  if (!coupon) throw new Error("Unauthorized or Not Found");
  return db.coupon.update({
    where: { id },
    data: { priority: parseInt(priority) || 0 },
  });
}
