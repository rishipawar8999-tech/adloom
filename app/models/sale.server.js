import prisma from "../db.server";

export async function getSales(shop) {
  try {
    return await prisma.sale.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { items: true } } },
    });
  } catch (error) {
    console.error("Error in getSales:", error);
    throw new Error("Failed to fetch sales");
  }
}

/**
 * Checks if any of the provided variant IDs are already part of another sale that overlaps in time.
 * @param {string} shop 
 * @param {string[]} variantIds 
 * @param {string} excludeSaleId - ID of current sale to ignore (e.g. when updating)
 * @param {Date} targetStartTime - Start time of the sale being checked
 * @param {Date} targetEndTime - End time of the sale being checked
 * @param {string} targetTimerId - Timer ID of the sale being checked
 */
export async function checkItemOverlaps(shop, variantIds, excludeSaleId = null, targetStartTime, targetEndTime, targetTimerId = null) {
  if (!targetStartTime || !targetEndTime) {
      return { ok: true };
  }

  const start = new Date(targetStartTime);
  const end = new Date(targetEndTime);

  const overlappingSales = await prisma.sale.findMany({
    where: {
      shop,
      status: { in: ["ACTIVE", "PENDING"] },
      NOT: excludeSaleId ? { id: excludeSaleId } : undefined,
      // Exclusive overlap logic: (StartA < EndB) AND (EndA > StartB)
      // This allows Sale A to end at exactly the same time Sale B starts.
      startTime: { lt: end },
      endTime: { gt: start },
    },
    include: {
      items: {
        where: {
          variantId: { in: variantIds }
        }
      }
    }
  });

  const conflicts = [];
  overlappingSales.forEach(sale => {
    const commonItems = sale.items.length;
    if (commonItems > 0) {
      // Check for item overlap
      conflicts.push(`"${sale.title}"`);

      // Check for timer conflict: Same product can't have two DIFFERENT timers at the same time
      // If either has no timer, it's okay (the other timer will be shown)
      // If both have timers, they must be the same timer ID
      if (targetTimerId && sale.timerId && targetTimerId !== sale.timerId) {
        conflicts.push(`(Timer conflict with "${sale.title}")`);
      }
    }
  });

  if (conflicts.length > 0) {
    const uniqueConflicts = [...new Set(conflicts)];
    return {
      ok: false,
      message: `Scheduling Conflict: This sale overlaps with ${uniqueConflicts.join(", ")}. Please adjust your dates or products.`
    };
  }

  return { ok: true };
}

export async function hasActiveSale(shop) {
  const activeSale = await prisma.sale.findFirst({
    where: {
      shop,
      status: "ACTIVE",
    },
  });
  return !!activeSale;
}

export async function deleteSale(saleId, admin) {
  try {
    const sale = await prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) return;

    if (sale.status === "ACTIVE") {
      await revertSale(saleId, admin);
    }

    await prisma.saleItem.deleteMany({ where: { saleId: saleId } });
    await prisma.sale.delete({ where: { id: saleId } });
  } catch (error) {
    console.error(`Error deleting sale ${saleId}:`, error);
    throw new Error(`Failed to delete sale ${saleId}`);
  }
}

export async function createSale({
  shop,
  title,
  discountType,
  value,
  startTime,
  endTime,
  items,
  overrideCents,
  discountStrategy,
  excludeDrafts,
  excludeOnSale,
  allowOverride,
  deactivationStrategy,
  timerId,
  tagsToAdd,
  tagsToRemove,
}) {
  try {
    // items should be an array of { productId, variantId }
    return await prisma.sale.create({
      data: {
        shop,
        title,
        discountType,
        value: parseFloat(value),
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        status: "PENDING",
        overrideCents: overrideCents === true,
        discountStrategy,
        excludeDrafts: excludeDrafts === true,
        excludeOnSale: excludeOnSale === true,
        allowOverride: allowOverride === true,
        deactivationStrategy,
        timerId: timerId || null,
        tagsToAdd,
        tagsToRemove,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            originalPrice: 0, // Will be updated when applied
            originalCompareAt: null,
          })),
        },
      },
    });
  } catch (error) {
    console.error("Error creating sale:", error);
    throw new Error("Failed to create sale");
  }
}

export async function updateSale(id, {
  title,
  discountType,
  value,
  startTime,
  endTime,
  items,
  overrideCents,
  discountStrategy,
  excludeDrafts,
  excludeOnSale,
  allowOverride,
  deactivationStrategy,
  timerId,
  tagsToAdd,
  tagsToRemove,
}) {
  try {
    // Delete old items and re-create
    await prisma.saleItem.deleteMany({ where: { saleId: id } });

    return await prisma.sale.update({
      where: { id },
      data: {
        title,
        discountType,
        value: parseFloat(value),
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        overrideCents: overrideCents === true,
        discountStrategy,
        excludeDrafts: excludeDrafts === true,
        excludeOnSale: excludeOnSale === true,
        allowOverride: allowOverride === true,
        deactivationStrategy,
        timerId: timerId || null,
        tagsToAdd,
        tagsToRemove,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            originalPrice: item.originalPrice || 0,
            originalCompareAt: item.originalCompareAt || null,
          })),
        },
      },
    });
  } catch (error) {
    console.error(`Error updating sale ${id}:`, error);
    throw new Error(`Failed to update sale ${id}`);
  }
}

export async function getSale(id, shop) {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!sale) return null;
    if (shop && sale.shop !== shop) return null;
    return sale;
  } catch (error) {
    console.error(`Error fetching sale ${id}:`, error);
    return null;
  }
}

// Logic to apply the discount
export async function applySale(saleId, admin) {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });

    if (!sale) return;
    if (sale.status === "ACTIVE") return;
    if (sale.status === "COMPLETED" && new Date() >= new Date(sale.endTime)) {
      throw new Error("Cannot activate a sale that has already expired. Please extend the end date first.");
    }

    const itemsToUpdate = [];
    const BATCH_SIZE = 250;
    const allItems = sale.items || [];

    // Helper to chunk array
    const chunkArray = (arr, size) => {
      const chunks = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

    const itemChunks = chunkArray(allItems, BATCH_SIZE);

    for (const chunk of itemChunks) {
        const variantIds = chunk.map(i => i.variantId);
        
        const query = `
          query getVariants($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on ProductVariant {
                id
                price
                compareAtPrice
                product {
                  id
                  status
                }
              }
            }
          }
        `;

        try {
            const response = await admin.graphql(query, { variables: { ids: variantIds } });
            const { data } = await response.json();
            const nodes = data?.nodes || [];

            // Create a map for quick lookup
            const variantMap = new Map();
            nodes.forEach(node => {
                if (node) variantMap.set(node.id, node);
            });

            for (const item of chunk) {
                const variantData = variantMap.get(item.variantId);
                
                if (!variantData) {
                    console.warn(`[ApplySale] Variant ${item.variantId} not found in Shopify. Skipping.`);
                    continue;
                }

                const currentPrice = parseFloat(variantData.price);
                const currentCompareAt = variantData.compareAtPrice ? parseFloat(variantData.compareAtPrice) : null;

                if (sale.excludeDrafts && variantData.product.status === "DRAFT") {
                    continue;
                }
                
                if (sale.excludeOnSale && currentCompareAt !== null) {
                    continue;
                }
                
                const strategy = sale.discountStrategy || "COMPARE_AT";
                let basePrice = currentPrice;
                let targetCompareAt = currentCompareAt;

                if (strategy === "COMPARE_AT") {
                  basePrice = currentCompareAt || currentPrice;
                  targetCompareAt = basePrice;
                } else if (strategy === "USE_CURRENT_AS_COMPARE") {
                  basePrice = currentPrice;
                  targetCompareAt = currentPrice;
                } else if (strategy === "KEEP_COMPARE_AT") {
                  basePrice = currentPrice;
                  targetCompareAt = currentCompareAt;
                }

                let discountAmount = 0;
                if (sale.discountType === "PERCENTAGE") {
                  discountAmount = basePrice * (sale.value / 100);
                } else if (sale.discountType === "FIXED_AMOUNT") {
                  discountAmount = sale.value;
                }

                let newPrice = basePrice - discountAmount;
                let newCompareAt = targetCompareAt;

                if (strategy === "INCREASE_COMPARE") {
                  newPrice = currentPrice;
                  newCompareAt = currentPrice + discountAmount;
                }

                if (sale.overrideCents) {
                  newPrice = Math.floor(newPrice) + 0.99;
                }

                if (newPrice < 0) newPrice = 0;

                itemsToUpdate.push({
                  id: item.id,
                  productId: variantData.product.id, 
                  variantId: item.variantId,
                  originalPrice: currentPrice,
                  originalCompareAt: currentCompareAt,
                  newPrice: newPrice.toFixed(2),
                  newCompareAt: newCompareAt ? newCompareAt.toFixed(2) : null,
                });
            }

        } catch (batchError) {
            console.error("Error processing batch in applySale:", batchError);
        }
    }

    if (itemsToUpdate.length === 0) {
       console.warn(`[ApplySale] No valid items found to update for sale ${saleId}`);
    }

    // Optimization: Use $transaction for DB updates BEFORE hitting Shopify
    // This ensures if Shopify fails or server crashes, we don't lose the originalPrice
    await prisma.$transaction(
        itemsToUpdate.map(update => 
            prisma.saleItem.updateMany({
                where: { id: update.id, originalPrice: 0 },
                data: { 
                  originalPrice: update.originalPrice,
                  originalCompareAt: update.originalCompareAt
                },
            })
        )
    );

    const mutation = `
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { field message }
        }
      }
    `;

    const updatesByProduct = itemsToUpdate.reduce((acc, item) => {
      if (!acc[item.productId]) acc[item.productId] = [];
      acc[item.productId].push(item);
      return acc;
    }, {});

    for (const productId in updatesByProduct) {
      try {
        const allVariants = updatesByProduct[productId].map(item => ({
          id: item.variantId,
          price: item.newPrice,
          compareAtPrice: item.newCompareAt
        }));

        // Fix M-1: Chunk variants into batches of 50 to avoid Shopify mutation limits
        const variantChunks = [];
        for (let i = 0; i < allVariants.length; i += 50) {
           variantChunks.push(allVariants.slice(i, i + 50));
        }

        for (const variants of variantChunks) {
           const response = await admin.graphql(mutation, {
             variables: { productId, variants },
           });
           const resData = await response.json();
           const userErrors = resData.data?.productVariantsBulkUpdate?.userErrors || [];
           if (userErrors.length > 0) {
               console.error(`Bulk update user errors for product ${productId}:`, userErrors);
               throw new Error(`Shopify API Error: ${userErrors[0].message}`);
           }
        }
        
        // Tag mutations
        if (sale.tagsToAdd) {
          const tags = sale.tagsToAdd.split(',').map(t => t.trim()).filter(Boolean);
          if (tags.length > 0) {
            await admin.graphql(`mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`, { variables: { id: productId, tags } });
          }
        }
        if (sale.tagsToRemove) {
          const tags = sale.tagsToRemove.split(',').map(t => t.trim()).filter(Boolean);
          if (tags.length > 0) {
            await admin.graphql(`mutation tagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`, { variables: { id: productId, tags } });
          }
        }
      } catch (bulkError) {
        console.error(`Error bulk updating product ${productId}:`, bulkError);
        throw bulkError;
      }
    }

    // DB updates were moved above Shopify mutations to fix crash window

    await prisma.sale.update({
      where: { id: saleId },
      data: { status: "ACTIVE" },
    });

    return itemsToUpdate.length;
  } catch (error) {
    console.error(`Error activating sale ${saleId}:`, error);
    throw new Error(`Failed to activate sale ${saleId}`);
  }
}

// Logic to revert the discount
export async function revertSale(saleId, admin) {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });

    if (!sale || sale.status !== "ACTIVE") return;

    const updatesByProduct = {};
    const BATCH_SIZE = 250;
    const allItems = sale.items || [];

    // Helper to chunk array
    const chunkArray = (arr, size) => {
      const chunks = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

    const itemChunks = chunkArray(allItems, BATCH_SIZE);

    for (const chunk of itemChunks) {
        const variantIds = chunk.map(i => i.variantId);
        
        const query = `
          query getVariants($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on ProductVariant {
                id
                price
                compareAtPrice
                product {
                  id
                }
              }
            }
          }
        `;

        try {
            const response = await admin.graphql(query, { variables: { ids: variantIds } });
            const { data } = await response.json();
            const nodes = data?.nodes || [];

            const variantMap = new Map();
            nodes.forEach(node => {
                if (node) variantMap.set(node.id, node);
            });

            for (const item of chunk) {
                const variantData = variantMap.get(item.variantId);
                
                if (!variantData) {
                    console.warn(`[RevertSale] Variant ${item.variantId} not found. Skipping reversion.`);
                    continue;
                }

                const currentPrice = parseFloat(variantData.price);
                const currentCompareAt = variantData.compareAtPrice ? parseFloat(variantData.compareAtPrice) : null;
                
                // Edge Case 2 Solution: Price Integrity Check
                const strategy = sale.discountStrategy || "COMPARE_AT";
                let basePrice = item.originalPrice;
                let origCompareAt = item.originalCompareAt !== null ? parseFloat(item.originalCompareAt) : null;
                
                if (strategy === "COMPARE_AT") {
                  basePrice = origCompareAt || item.originalPrice;
                }
                
                let expectedDiscountedPrice = basePrice;
                if (strategy === "INCREASE_COMPARE") {
                  expectedDiscountedPrice = item.originalPrice;
                } else {
                  if (sale.discountType === "PERCENTAGE") {
                    expectedDiscountedPrice = basePrice - (basePrice * (sale.value / 100));
                  } else if (sale.discountType === "FIXED_AMOUNT") {
                    expectedDiscountedPrice = basePrice - sale.value;
                  }
                }
                
                if (expectedDiscountedPrice < 0) expectedDiscountedPrice = 0;

                let expectedCompareAt = origCompareAt;
                if (strategy === "COMPARE_AT") {
                  expectedCompareAt = basePrice;
                } else if (strategy === "USE_CURRENT_AS_COMPARE") {
                  expectedCompareAt = item.originalPrice;
                }
                
                if (strategy === "INCREASE_COMPARE") {
                  let discountAmount = 0;
                  if (sale.discountType === "PERCENTAGE") discountAmount = basePrice * (sale.value / 100);
                  else if (sale.discountType === "FIXED_AMOUNT") discountAmount = sale.value;
                  expectedCompareAt = item.originalPrice + discountAmount;
                }

                const priceChanged = Math.abs(currentPrice - expectedDiscountedPrice) > 0.01 && !["0.00", "0"].includes(currentPrice.toFixed(2));
                
                let compareAtChanged = false;
                if (currentCompareAt !== null || expectedCompareAt !== null) {
                   if (currentCompareAt === null || expectedCompareAt === null || Math.abs(currentCompareAt - expectedCompareAt) > 0.01) {
                       compareAtChanged = true;
                   }
                }

                if (priceChanged || compareAtChanged) {
                   console.warn(`[RevertSale] Manual change detected for variant ${item.variantId}. Expected Price: ${expectedDiscountedPrice}, Found: ${currentPrice}. Expected CompareAt: ${expectedCompareAt}, Found: ${currentCompareAt}. Preserving manual change.`);
                   continue; 
                }
                let targetPrice = String(item.originalPrice);
                let targetCompareAt = item.originalCompareAt !== null ? String(item.originalCompareAt) : null; 
                
                if (sale.deactivationStrategy === "REPLACE_WITH_COMPARE" && currentCompareAt) {
                  targetPrice = String(currentCompareAt);
                  targetCompareAt = null;
                }

                if (!updatesByProduct[item.productId]) updatesByProduct[item.productId] = [];
                updatesByProduct[item.productId].push({
                  id: item.variantId,
                  price: targetPrice,
                  compareAtPrice: targetCompareAt
                });
            }
        } catch (batchError) {
             console.error("Error processing batch in revertSale:", batchError);
        }
    }

    for (const productId in updatesByProduct) {
      try {
        const mutation = `
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }
        `;

        // Fix M-1: Chunk variants into batches of 50
        const allVariants = updatesByProduct[productId];
        const variantChunks = [];
        for (let i = 0; i < allVariants.length; i += 50) {
           variantChunks.push(allVariants.slice(i, i + 50));
        }

        for (const variants of variantChunks) {
           const response = await admin.graphql(mutation, {
             variables: { productId, variants },
           });
           const resData = await response.json();
           const userErrors = resData.data?.productVariantsBulkUpdate?.userErrors || [];
           if (userErrors.length > 0) {
               console.error(`Revert bulk update user errors for product ${productId}:`, userErrors);
               throw new Error(`Shopify API Error: ${userErrors[0].message}`);
           }
        }
        
        // Tag mutations (Reversed from applySale)
        if (sale.tagsToAdd) {
          const tags = sale.tagsToAdd.split(',').map(t => t.trim()).filter(Boolean);
          if (tags.length > 0) {
            await admin.graphql(`mutation tagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`, { variables: { id: productId, tags } });
          }
        }
        if (sale.tagsToRemove) {
          const tags = sale.tagsToRemove.split(',').map(t => t.trim()).filter(Boolean);
          if (tags.length > 0) {
            await admin.graphql(`mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`, { variables: { id: productId, tags } });
          }
        }
      } catch (bulkError) {
        console.error(`Error revert-bulk updating product ${productId}:`, bulkError);
      }
    }

    await prisma.sale.update({
      where: { id: saleId },
      data: { status: "COMPLETED" },
    });
  } catch (error) {
    console.error(`Error reverting sale ${saleId}:`, error);
    throw new Error(`Failed to revert sale ${saleId}`);
  }
}
