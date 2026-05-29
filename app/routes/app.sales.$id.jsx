import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, useNavigate, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  Page, Layout, Text, Card, Button, BlockStack, Box, List, InlineStack, TextField, Select, Checkbox, RadioButton, Banner, Thumbnail, Tag, Icon, Collapsible, Badge
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { DirtyStateModal } from "../components/DirtyStateModal";
import { StrategyExample } from "../components/StrategyExample";
import { ActionErrorModal } from "../components/ActionErrorModal";

export async function loader({ request, params }) {
  console.log("Loading Sale:", params.id); // Debug Log
  const { authenticate } = await import("../shopify.server");
  const { admin, session } = await authenticate.admin(request);
  const { getSale } = await import("../models/sale.server");
  const { getTimers } = await import("../models/timer.server");
  
  try {
    const sale = await getSale(params.id, session.shop);
    if (!sale) {
        console.error("Sale not found for ID:", params.id);
        throw new Response("Sale not found", { status: 404 });
    }
    
    // Fetch product details from Shopify for display
    const uniqueProductIds = [...new Set(sale.items.map(i => i.productId))];

    const productMap = {};
    for (const pid of uniqueProductIds) {
        try {
            const response = await admin.graphql(`
                query getProduct($id: ID!) {
                  product(id: $id) {
                    id
                    title
                    featuredImage { url }
                    variants(first: 100) {
                      edges {
                        node {
                          id
                          title
                          price
                        }
                      }
                    }
                  }
                }
            `, { variables: { id: pid } });
            
            const data = await response.json();
            if (data.data?.product) {
                const p = data.data.product;
                productMap[pid] = {
                    title: p.title,
                    image: p.featuredImage?.url || null,
                    variants: {},
                };
                p.variants.edges.forEach(({ node }) => {
                    productMap[pid].variants[node.id] = {
                        title: node.title,
                        price: node.price,
                    };
                });
            }
        } catch (e) {
            console.error("Error fetching product:", pid, e);
        }
    }

    // Enrich sale items with product details
    const enrichedItems = sale.items.map(item => ({
        ...item,
        productTitle: productMap[item.productId]?.title || "Unknown product",
        variantTitle: productMap[item.productId]?.variants?.[item.variantId]?.title || "Unknown variant",
        image: productMap[item.productId]?.image || null,
        currentPrice: productMap[item.productId]?.variants?.[item.variantId]?.price || null,
    }));

    // Get shop domain for preview
    let shopDomain = "";
    try {
        const shopRes = await admin.graphql(`{ shop { myshopifyDomain } }`);
        const shopData = await shopRes.json();
        shopDomain = shopData.data?.shop?.myshopifyDomain || "";
    } catch {}

    const timers = await getTimers(session.shop);
    return json({ sale: { ...sale, items: enrichedItems }, shopDomain, timers });
  } catch (error) {
    console.error("Loader Error:", error);
    throw error; 
  }
}

export async function action({ request, params }) {
  const { authenticate } = await import("../shopify.server");
  const { admin, session } = await authenticate.admin(request);
  const { getSale, updateSale, applySale, revertSale, checkItemOverlaps } = await import("../models/sale.server");
  const { checkGlobalVariantLimit } = await import("../models/billing.server");

  try {
  const formData = await request.formData();

  const intent = formData.get("intent");

  // Handle action buttons
  if (intent === "deactivate") {
    const sale = await getSale(params.id, session.shop);
    if (!sale) throw new Response("Unauthorized", { status: 403 });
    await revertSale(params.id, admin);
    return json({ success: true, message: "Sale deactivated successfully." });
  }

  if (intent === "reactivate") {
    const sale = await getSale(params.id, session.shop);
    if (!sale) throw new Response("Unauthorized", { status: 403 });

    const items = sale.items || [];
    const variantIds = items.map(i => i.variantId);

    // 1. Check for product overlaps and timer consistency
    const overlapCheck = await checkItemOverlaps(session.shop, variantIds, params.id, sale.startTime, sale.endTime, sale.timerId);
    if (!overlapCheck.ok) {
        return json({ errors: { base: overlapCheck.message } }, { status: 400 });
    }
    
    // 2. Check global variant limit (Time-aware)
    const variantLimitCheck = await checkGlobalVariantLimit(request, variantIds, sale.startTime, sale.endTime, params.id);
    if (!variantLimitCheck.ok) {
         return json({ errors: { base: variantLimitCheck.message } }, { status: 400 });
    }

    const count = await applySale(params.id, admin);
    return json({ success: true, message: `Sale reactivated. ${count} prices updated.` });
  }


  // Handle save/update
  const title = formData.get("title");
  const discountType = formData.get("discountType");
  const value = formData.get("value");
  const startTime = formData.get("startTime");
  const endTime = formData.get("endTime");
  const itemsString = formData.get("items");
  const clientTimezoneOffset = formData.get("clientTimezoneOffset");

  const overrideCents = formData.get("overrideCents") === "true";
  const discountStrategy = formData.get("discountStrategy");
  const excludeDrafts = formData.get("excludeDrafts") === "true";
  const excludeOnSale = formData.get("excludeOnSale") === "true";
  const deactivationStrategy = formData.get("deactivationStrategy") || "RESTORE";
  const timerId = formData.get("timerId");
  const tagsToAdd = formData.get("tagsToAdd");
  const tagsToRemove = formData.get("tagsToRemove");

  let items = JSON.parse(itemsString || "[]");

  const errors = {};
  if (!title) errors.title = "Title is required";
  if (!value) errors.value = "Value is required";
  if (!startTime) errors.startTime = "Start time is required";
  if (!endTime) errors.endTime = "End time is required";
  if (items.length === 0) errors.items = "Select at least one product or collection";

  if (Object.keys(errors).length > 0) {
    return json({ errors });
  }

  const uniqueItems = Array.from(new Map(items.map(item => [item.variantId, item])).values());
  const variantIds = uniqueItems.map(i => i.variantId);
  
  // Check for conflicts and limits across all active/scheduled sales
  // Treat input time as UTC initially so that the client offset (minutes from UTC) applies correctly.
  // This avoids server-local-time interference.
  let start = new Date(startTime + "Z");
  let end = new Date(endTime + "Z");

  // Apply timezone adjustment if available
  if (clientTimezoneOffset) {
     const offset = parseInt(clientTimezoneOffset, 10);
     if (!isNaN(offset)) {
         start = new Date(start.getTime() + (offset * 60 * 1000));
         end = new Date(end.getTime() + (offset * 60 * 1000));
     }
  }


  const sale = await getSale(params.id, session.shop);
  if (!sale) throw new Response("Unauthorized", { status: 403 });

  // 1. Check for product overlaps and timer consistency
  const overlapCheck = await checkItemOverlaps(session.shop, variantIds, params.id, start, end, timerId);
  if (!overlapCheck.ok) {
      return json({ errors: { base: overlapCheck.message } }, { status: 400 });
  }
  
  // 2. Check global variant limit (Time-aware)
  const variantLimitCheck = await checkGlobalVariantLimit(request, variantIds, start, end, params.id);
  if (!variantLimitCheck.ok) {
       return json({ errors: { base: variantLimitCheck.message } }, { status: 400 });
  }

  await updateSale(params.id, {
    shop: session.shop,
    title,
    discountType,
    value,
    startTime: start,
    endTime: end,
    items: uniqueItems,
    overrideCents,
    discountStrategy,
    excludeDrafts,
    excludeOnSale,
    deactivationStrategy,
    timerId,
    tagsToAdd,
    tagsToRemove,
  });

  return json({ success: true, message: "Sale updated successfully." });
  } catch (error) {
    console.error("Action failed:", error);
    const msg = (error.message && (error.message.includes("Shopify API Error") || error.message.includes("Cannot activate"))) ? error.message : "Failed to update sale. Please try again.";
    return json({ errors: { base: msg } }, { status: 500 });
  }
}

export default function EditSale() {
  const { sale, shopDomain, timers } = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const actionData = useActionData();

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Sale saved successfully");
    } else if (actionData?.errors) {
      const firstError = Object.values(actionData.errors)[0];
      shopify.toast.show(firstError || "Error saving sale", { isError: true });
    }
  }, [actionData, shopify]);

  // Pre-fill state from loaded sale
  const [selectedItems, setSelectedItems] = useState(
    sale.items.map(item => ({
      productId: item.productId,
      variantId: item.variantId,
      productTitle: item.productTitle || "",
      variantTitle: item.variantTitle || "",
      image: item.image || null,
      originalPrice: item.originalPrice,
    }))
  );
  const [title, setTitle] = useState(sale.title);
  const [discountType, setDiscountType] = useState(sale.discountType);
  const [value, setValue] = useState(String(Math.abs(sale.value)));
  const [overrideCents, setOverrideCents] = useState(sale.overrideCents);
  const [discountStrategy, setDiscountStrategy] = useState(sale.discountStrategy);

  // Applies To
  const [appliesToType, setAppliesToType] = useState("products");
  const [excludeDrafts, setExcludeDrafts] = useState(sale.excludeDrafts);
  const [excludeOnSale, setExcludeOnSale] = useState(sale.excludeOnSale);
  const [excludeCertainProducts, setExcludeCertainProducts] = useState(false);

  // Dates
  const startDT = new Date(sale.startTime);
  const endDT = new Date(sale.endTime);
  
  // Helper to extraction local YYYY-MM-DD
  const getLocalISODate = (date) => {
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - (offset * 60 * 1000));
    return local.toISOString().split("T")[0];
  };

  const [startDate, setStartDate] = useState(getLocalISODate(startDT));
  const [startTime, setStartTime] = useState(startDT.toTimeString().slice(0, 5));
  const [endDate, setEndDate] = useState(getLocalISODate(endDT));
  const [endTime, setEndTime] = useState(endDT.toTimeString().slice(0, 5));
  const [setEndTimer, setSetEndTimer] = useState(true);

  // Activation / Deactivation
  const [deactivationStrategy, setDeactivationStrategy] = useState(sale.deactivationStrategy || "RESTORE");

  // Timer & Tags
  const [timerId, setTimerId] = useState(sale.timerId || "");
  const [tagsToAdd, setTagsToAdd] = useState(sale.tagsToAdd || "");
  const [tagsToRemove, setTagsToRemove] = useState(sale.tagsToRemove || "");
  const [combinationsOpen, setCombinationsOpen] = useState(false);
  const [showExample, setShowExample] = useState(false);

  const submit = useSubmit();

  const navigation = useNavigation();

  // --- Unsaved changes guard ---
  const [isDirty, setIsDirty] = useState(false);
  const dirty = (setter) => (val) => { setIsDirty(true); setter(val); };


  const isLoading = navigation.state === "submitting";

  const [selectedCollections, setSelectedCollections] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedVendors, setSelectedVendors] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [vendorInput, setVendorInput] = useState("");

  const selectProducts = async () => {
    const response = await shopify.resourcePicker({
      type: "product",
      multiple: true,
    });

    if (response) {
      const variants = [];
      response.forEach((product) => {
        product.variants.forEach((variant) => {
          variants.push({
            productId: product.id,
            variantId: variant.id,
            productTitle: product.title,
            variantTitle: variant.title,
            image: product.images[0]?.originalSrc,
          });
        });
      });
      setSelectedItems(variants);
    }
  };

  const selectCollections = async () => {
    const response = await shopify.resourcePicker({
        type: "collection",
        multiple: true,
    });
    if (response) {
        setSelectedCollections(response);
    }
  };

  const handleBrowse = () => {
      if (appliesToType === "products") selectProducts();
      else if (appliesToType === "collections") selectCollections();
  };

  const removeCollection = (id) => {
      setSelectedCollections(selectedCollections.filter(c => c.id !== id));
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      shopify.toast.show("Sale Title is required", { isError: true });
      return;
    }
    
    if (!value || isNaN(value) || parseFloat(value) <= 0) {
      shopify.toast.show("Please enter a valid discount amount greater than 0", { isError: true });
      return;
    }

    if (!startDate || !startTime) {
      shopify.toast.show("Start date and time are required.", { isError: true });
      return;
    }

    if (setEndTimer && (!endDate || !endTime)) {
      shopify.toast.show("End date and time are required when 'Set end date' is checked.", { isError: true });
      return;
    }

    const startDateTime = `${startDate}T${startTime}:00`;
    const endDateTime = setEndTimer ? `${endDate}T${endTime}:00` : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const timezoneOffset = new Date().getTimezoneOffset().toString();

    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("title", title);
    formData.append("discountType", discountType);
    formData.append("value", value);
    formData.append("startTime", startDateTime);
    formData.append("endTime", endDateTime);
    formData.append("clientTimezoneOffset", timezoneOffset); // Send offset
    formData.append("items", JSON.stringify(selectedItems));

    formData.append("overrideCents", overrideCents.toString());
    formData.append("discountStrategy", discountStrategy);
    formData.append("excludeDrafts", excludeDrafts.toString());
    formData.append("excludeOnSale", excludeOnSale.toString());
    formData.append("deactivationStrategy", deactivationStrategy);
    formData.append("timerId", timerId);
    formData.append("tagsToAdd", tagsToAdd);
    formData.append("tagsToRemove", tagsToRemove);

    formData.append("appliesToType", appliesToType);
    formData.append("selectedCollections", JSON.stringify(selectedCollections));
    formData.append("selectedTags", JSON.stringify(selectedTags));
    formData.append("selectedVendors", JSON.stringify(selectedVendors));

    submit(formData, { method: "post" });
  };

  const handleDeactivate = () => {
    submit({ intent: "deactivate" }, { method: "post" });
  };

  const handleReactivate = () => {
    submit({ intent: "reactivate" }, { method: "post" });
  };

  const statusBadge = () => {
    switch (sale.status) {
      case "ACTIVE":
        return <Badge tone="success">Active</Badge>;
      case "PENDING":
        return <Badge tone="attention">Scheduled</Badge>;
      case "COMPLETED":
        return <Badge tone="warning">Expired</Badge>;
      default:
        return <Badge>{sale.status}</Badge>;
    }
  };

  return (
    <Page
      backAction={{ url: "/app" }}
      title={sale.title}
      titleMetadata={statusBadge()}
      secondaryActions={[
        {
          content: "Preview",
          onAction: () => {
            if (shopDomain) window.open(`https://${shopDomain}`, "_blank");
          },
          disabled: !shopDomain,
        },
        ...(sale.status === "PENDING"
          ? [{
              content: "Activate Now",
              onAction: handleReactivate,
              loading: isLoading,
            }]
          : []),
        ...(sale.status === "ACTIVE"
          ? [{
              content: "Deactivate",
              onAction: handleDeactivate,
              loading: isLoading,
              destructive: true,
            }]
          : []),
        {
          content: "Duplicate",
          onAction: () => navigate(`/app/sales/new?duplicate=${sale.id}`),
        },
      ]}
    >
      <DirtyStateModal isDirty={isDirty} />
      <Layout>
        <Layout.Section>
          <div className="animate-fade-in-up stagger-1">
            <BlockStack gap="400">
            {/* Success/action banner */}
            {actionData?.success && (
               <Banner tone="success" title={actionData.message}>
                   <p>Have the prices been updated correctly for the selected products?</p>
                   <div style={{ marginTop: "0.5rem" }}>
                       <InlineStack gap="200">
                           <Button size="slim">👍 Everything is great</Button>
                           <Button size="slim" variant="plain">👎 There is a problem</Button>
                       </InlineStack>
                   </div>
               </Banner>
            )}

            <ActionErrorModal />

            <div className="elite-card">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm">Title</Text>
                  <div className="elite-input-focus">
                    <TextField
                      label="Title"
                      labelHidden
                      value={title}
                      onChange={dirty(setTitle)}
                      autoComplete="off"
                      maxLength={255}
                      showCharacterCount
                      helpText="This title is not visible to the clients."
                      error={actionData?.errors?.title}
                    />
                  </div>
                </BlockStack>
              </Card>
            </div>

            <Card>
              <BlockStack gap="400">
                 <Text as="h2" variant="headingSm">Discount value</Text>
                 <InlineStack gap="400">
                    <div style={{ flex: 1 }}>
                        <Select
                            label="Discount type"
                            labelHidden
                            options={[
                              { label: "Percentage", value: "PERCENTAGE" },
                              { label: "Fixed Amount", value: "FIXED_AMOUNT" },
                            ]}
                            value={discountType}
                            onChange={setDiscountType}
                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <TextField
                            label="Value"
                            labelHidden
                            type="number"
                            value={value}
                            onChange={dirty(setValue)}
                            suffix={discountType === "PERCENTAGE" ? "%" : ""}
                            autoComplete="off"
                            error={actionData?.errors?.value}
                        />
                    </div>
                 </InlineStack>
                 <Checkbox
                    label="Override cents"
                    checked={overrideCents}
                    onChange={setOverrideCents}
                 />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                 <InlineStack align="space-between">
                    <Text as="h2" variant="headingSm">Discount strategy</Text>
                     <Button 
                       variant="plain" 
                       onClick={() => setShowExample(!showExample)}
                     >
                       {showExample ? "Hide example" : "Show example"}
                     </Button>
                 </InlineStack>

                 <Collapsible open={showExample} id="strategy-example">
                    <Box paddingBlockEnd="400">
                      <StrategyExample 
                        strategy={discountStrategy} 
                        discountType={discountType} 
                        value={value} 
                      />
                    </Box>
                 </Collapsible>
                 
                 <BlockStack gap="200">
                    <RadioButton
                        label="Calculate discount based on compare-at price"
                        checked={discountStrategy === "COMPARE_AT"}
                        id="strategy-compare-at"
                        name="discountStrategy"
                        onChange={() => setDiscountStrategy("COMPARE_AT")}
                    />
                    <RadioButton
                        label="Discount current price but keep compare-at price unchanged"
                        checked={discountStrategy === "KEEP_COMPARE_AT"}
                        id="strategy-keep-compare-at"
                        name="discountStrategy"
                        onChange={() => setDiscountStrategy("KEEP_COMPARE_AT")}
                    />
                     <RadioButton
                        label="Use current price as compare-at price and discount it"
                        checked={discountStrategy === "USE_CURRENT_AS_COMPARE"}
                        id="strategy-use-current"
                        name="discountStrategy"
                        onChange={() => setDiscountStrategy("USE_CURRENT_AS_COMPARE")}
                    />
                     <RadioButton
                        label="Keep current price and increase compare-at price"
                        checked={discountStrategy === "INCREASE_COMPARE"}
                        id="strategy-increase-compare"
                        name="discountStrategy"
                        onChange={() => setDiscountStrategy("INCREASE_COMPARE")}
                    />
                 </BlockStack>
              </BlockStack>
            </Card>


            <Card>
                <BlockStack gap="400">
                    <Text as="h2" variant="headingSm">Applies to</Text>
                    <InlineStack gap="200">
                         <div style={{ flex: 1 }}>
                             <Select
                                options={[
                                    { label: "Products / Variants", value: "products" },
                                    { label: "Collections", value: "collections" },
                                    { label: "Tags", value: "tags" },
                                    { label: "Vendors", value: "vendors" },
                                    { label: "Whole store", value: "all" },
                                ]}
                                value={appliesToType}
                                onChange={setAppliesToType}
                                label="Applies to"
                                labelHidden
                             />
                         </div>
                         <div style={{ flex: 2 }}>
                            {appliesToType === "tags" ? (
                                <TextField
                                    value={tagInput}
                                    onChange={setTagInput}
                                    placeholder="Search tags"
                                    autoComplete="off"
                                    prefix={<Icon source={SearchIcon} />}
                                    connectedRight={<Button onClick={() => {
                                        if (tagInput && !selectedTags.includes(tagInput)) {
                                            setSelectedTags([...selectedTags, tagInput]);
                                            setTagInput("");
                                        }
                                    }}>Add</Button>}
                                    label="Search tags"
                                    labelHidden
                                />
                            ) : appliesToType === "vendors" ? (
                                <TextField
                                    value={vendorInput}
                                    onChange={setVendorInput}
                                    placeholder="Search vendors"
                                    autoComplete="off"
                                    prefix={<Icon source={SearchIcon} />}
                                    connectedRight={<Button onClick={() => {
                                        if (vendorInput && !selectedVendors.includes(vendorInput)) {
                                            setSelectedVendors([...selectedVendors, vendorInput]);
                                            setVendorInput("");
                                        }
                                    }}>Add</Button>}
                                    label="Search vendors"
                                    labelHidden
                                />
                            ) : (
                                <TextField
                                    value={""}
                                    placeholder={appliesToType === "collections" ? "Search collections" : "Search products"}
                                    autoComplete="off"
                                    prefix={<Icon source={SearchIcon} />}
                                    connectedRight={<Button onClick={handleBrowse} disabled={appliesToType === "all"}>Browse</Button>}
                                    label="Search"
                                    labelHidden
                                    disabled={appliesToType === "all"}
                                />
                            )}
                         </div>
                    </InlineStack>

                    {appliesToType === "collections" && (
                        <Banner tone="info">
                            <p><strong>Important!</strong></p>
                            <p>Be aware that Shopify has an internal issue with filtering products in smart collections. <Button variant="plain" external>Read more</Button></p>
                        </Banner>
                    )}

                    {appliesToType === "products" && selectedItems.length > 0 && (
                        <BlockStack gap="200">
                           <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                              <InlineStack align="space-between">
                                   <Text variant="bodySm" fontWeight="semibold">{selectedItems.length} variants selected</Text>
                                   <Button variant="plain" onClick={() => setSelectedItems([])}>Remove all</Button>
                              </InlineStack>
                           </Box>
                           {selectedItems.slice(0, 20).map((item, idx) => (
                             <Box key={item.variantId || idx} padding="200" background="bg-surface-secondary" borderRadius="200">
                               <InlineStack gap="300" blockAlign="center" wrap={false}>
                                 <Thumbnail
                                   source={item.image || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_small.png"}
                                   alt={item.productTitle}
                                   size="small"
                                 />
                                 <BlockStack gap="0">
                                   <Text as="span" fontWeight="semibold" variant="bodySm">{item.productTitle}</Text>
                                   {item.variantTitle && item.variantTitle !== "Default Title" && (
                                     <Text as="span" variant="bodySm" tone="subdued">{item.variantTitle}</Text>
                                   )}
                                 </BlockStack>
                                 <div style={{ marginLeft: "auto" }}>
                                   <Text as="span" variant="bodySm" tone="subdued">${Number(item.originalPrice).toFixed(2)}</Text>
                                 </div>
                               </InlineStack>
                             </Box>
                           ))}
                           {selectedItems.length > 20 && (
                             <Text as="p" variant="bodySm" tone="subdued">...and {selectedItems.length - 20} more variants</Text>
                           )}
                        </BlockStack>
                     )}

                     {appliesToType === "collections" && selectedCollections.length > 0 && (
                        <BlockStack gap="200">
                             <InlineStack align="space-between">
                                <Checkbox label={`${selectedCollections.length} selected`} checked={true} disabled/>
                                <Button size="slim" onClick={() => setSelectedCollections([])}>Remove collections</Button>
                             </InlineStack>
                             {selectedCollections.map(collection => (
                                 <Box key={collection.id} padding="200" background="bg-surface-secondary" borderRadius="200">
                                    <InlineStack gap="400" align="start" blockAlign="center">
                                        <Checkbox checked={true} onChange={() => removeCollection(collection.id)}/>
                                        <Thumbnail
                                            source={collection.image?.originalSrc || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1_small.png?format=webp&v=1530129177"}
                                            alt={collection.title}
                                        />
                                        <Text fontWeight="bold" as="span">{collection.title}</Text>
                                    </InlineStack>
                                 </Box>
                             ))}
                        </BlockStack>
                     )}

                     {appliesToType === "tags" && selectedTags.length > 0 && (
                        <InlineStack gap="200">
                            {selectedTags.map(tag => (
                                <Tag key={tag} onRemove={() => setSelectedTags(selectedTags.filter(t => t !== tag))}>{tag}</Tag>
                            ))}
                        </InlineStack>
                     )}

                     {appliesToType === "vendors" && selectedVendors.length > 0 && (
                        <InlineStack gap="200">
                            {selectedVendors.map(vendor => (
                                <Tag key={vendor} onRemove={() => setSelectedVendors(selectedVendors.filter(v => v !== vendor))}>{vendor}</Tag>
                            ))}
                        </InlineStack>
                     )}

                    <BlockStack gap="200">
                        <Text as="h3" variant="bodyMd" fontWeight="semibold">Exclude</Text>
                         <Checkbox
                            label="Exclude draft products from sale"
                            checked={excludeDrafts}
                            onChange={setExcludeDrafts}
                         />
                         <Checkbox
                            label="Exclude product variants that are on sale (with a compare-at price set)"
                            checked={excludeOnSale}
                            onChange={setExcludeOnSale}
                         />
                         <Checkbox
                            label="Exclude certain products from sale"
                            checked={excludeCertainProducts}
                            onChange={setExcludeCertainProducts}
                         />
                    </BlockStack>
                </BlockStack>
            </Card>

            <Card>
                 <BlockStack gap="400">
                     <Text as="h2" variant="headingSm">Combinations</Text>
                     <BlockStack gap="200">
                        <Button
                            variant="plain"
                            onClick={() => setCombinationsOpen(!combinationsOpen)}
                            textAlign="left"
                        >
                            <Text as="p" tone="subdued">How to prevent combining <strong>discount codes</strong> with products on sale. {combinationsOpen ? "Hide instructions" : "Show instructions"}</Text>
                        </Button>
                        <Collapsible open={combinationsOpen} id="combinations-collapsible">
                            <Box paddingBlockStart="200">
                                <Text as="p" variant="bodyMd">
                                    Currently, Shopify doesn't have a native feature to directly restrict discount codes from being applied to sale items.
                                </Text>
                            </Box>
                        </Collapsible>
                     </BlockStack>
                 </BlockStack>
            </Card>

            <Card>
                 <BlockStack gap="400">
                    <Text as="h2" variant="headingSm">Active dates</Text>
                    <InlineStack gap="400">
                        <div style={{ flex: 1 }}>
                            <TextField
                                label="Start date"
                                type="date"
                                value={startDate}
                                onChange={setStartDate}
                                autoComplete="off"
                            />
                        </div>
                         <div style={{ flex: 1 }}>
                            <TextField
                                label="Start time"
                                type="time"
                                value={startTime}
                                onChange={setStartTime}
                                autoComplete="off"
                            />
                        </div>
                    </InlineStack>
                    <Checkbox
                        label="Set end date"
                        checked={setEndTimer}
                        onChange={setSetEndTimer}
                    />
                    {setEndTimer && (
                         <InlineStack gap="400">
                            <div style={{ flex: 1 }}>
                                <TextField
                                    label="End date"
                                    type="date"
                                    value={endDate}
                                    onChange={setEndDate}
                                    autoComplete="off"
                                />
                            </div>
                             <div style={{ flex: 1 }}>
                                <TextField
                                    label="End time"
                                    type="time"
                                    value={endTime}
                                    onChange={setEndTime}
                                    autoComplete="off"
                                />
                            </div>
                        </InlineStack>
                    )}
                 </BlockStack>
            </Card>

             <Card>
                <BlockStack gap="400">
                    <Text as="h2" variant="headingSm">Deactivation</Text>
                     <BlockStack gap="200">
                        <RadioButton
                            label="Restore prices exactly as they were before the sale activation"
                            checked={deactivationStrategy === "RESTORE"}
                            id="deactivate-restore"
                            name="deactivationStrategy"
                            onChange={() => setDeactivationStrategy("RESTORE")}
                             helpText="If a product was already on sale, it will return to that sale price after deactivation."
                        />
                        <RadioButton
                            label="Replace current price with compare-at price and remove compare-at value"
                            checked={deactivationStrategy === "REPLACE_WITH_COMPARE"}
                            id="deactivate-replace"
                            name="deactivationStrategy"
                            onChange={() => setDeactivationStrategy("REPLACE_WITH_COMPARE")}
                        />
                     </BlockStack>
                </BlockStack>
            </Card>

             <Card>
                <BlockStack gap="400">
                    <Text as="h2" variant="headingSm">Product page timer</Text>
                    <Text as="p" tone="subdued">The timer will be automatically configured with the sale's end date upon activation.</Text>
                    <Select
                        label="Timer display"
                        labelHidden
                        options={[
                          { label: "Display no timer", value: "" },
                          ...((timers || []).map(t => ({ label: t.name, value: t.id })))
                        ]}
                        value={timerId}
                        onChange={setTimerId}
                    />
                </BlockStack>
            </Card>

            <Card>
                 <BlockStack gap="400">
                    <Text as="h2" variant="headingSm">Product tags</Text>

                    <BlockStack gap="200">
                        <Text as="p" variant="bodyMd">Tags to add during sale activation (removes upon deactivation)</Text>
                         <TextField
                            label="Tags to add"
                            labelHidden
                            placeholder="Search tags"
                            value={tagsToAdd}
                            onChange={setTagsToAdd}
                            autoComplete="off"
                            prefix={<Icon source={SearchIcon} />}
                            helpText="Separate tags with comma"
                        />
                        {tagsToAdd && (
                            <InlineStack gap="200">
                                {tagsToAdd.split(",").filter(t => t.trim()).map((tag, i) => (
                                    <Tag key={i}>{tag.trim()}</Tag>
                                ))}
                            </InlineStack>
                        )}
                    </BlockStack>

                     <BlockStack gap="200">
                        <Text as="p" variant="bodyMd">Tags to remove during sale activation (resets upon deactivation)</Text>
                         <TextField
                            label="Tags to remove"
                            labelHidden
                            placeholder="Search tags"
                            value={tagsToRemove}
                            onChange={setTagsToRemove}
                            autoComplete="off"
                            prefix={<Icon source={SearchIcon} />}
                             helpText="Separate tags with comma"
                        />
                         {tagsToRemove && (
                            <InlineStack gap="200">
                                {tagsToRemove.split(",").filter(t => t.trim()).map((tag, i) => (
                                    <Tag key={i}>{tag.trim()}</Tag>
                                ))}
                             </InlineStack>
                         )}
                     </BlockStack>
                 </BlockStack>
             </Card>

             <div className="animate-fade-in-up stagger-3" style={{ marginTop: "1rem", marginBottom: "3rem" }}>
                  <Button variant="primary" loading={isLoading} size="large" onClick={handleSubmit}>Save Changes</Button>
             </div>

           </BlockStack>
          </div>
        </Layout.Section>


        <Layout.Section variant="oneThird">
             <Card>
                <BlockStack gap="200">
                    <Text as="h2" variant="headingSm">Summary</Text>
                    <Text as="p" fontWeight="bold">{title || "No title yet"}</Text>
                    <Text as="p" fontWeight="semibold">Details</Text>
                    <List type="bullet">
                        <List.Item>{value}{discountType === "PERCENTAGE" ? "%" : "$"} off {selectedItems.length} products</List.Item>
                         <List.Item>Active from {new Date(`${startDate}T${startTime}`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</List.Item>
                    </List>
                </BlockStack>
             </Card>
             <div style={{ marginTop: "1rem" }}>
                 <Card>
                    <BlockStack gap="200">
                        <Text as="p">Have an idea for a missing feature? We'd love to hear it!</Text>
                        <Button variant="plain" external>Request a feature</Button>
                    </BlockStack>
                 </Card>
             </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  return (
    <Page title="Error">
      <Layout>
        <Layout.Section>
          <Banner tone="critical" title="Something went wrong">
            <p>
              {isRouteErrorResponse(error)
                ? `${error.status} ${error.statusText} - ${error.data}`
                : error instanceof Error
                ? error.message
                : "Unknown error occurred"}
            </p>
            <div style={{ marginTop: "1rem" }}>
              <Button onClick={() => window.location.reload()}>Reload Page</Button>
            </div>
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
