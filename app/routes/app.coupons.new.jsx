import { useState } from "react";
import { json, redirect } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit, useLoaderData, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { checkLimit, checkDesignLimit } from "../models/billing.server";
import { DirtyStateModal } from "../components/DirtyStateModal";
import { ActionErrorModal } from "../components/ActionErrorModal";
import {
  Page,
  Layout,
  Card,
  TextField,
  Select,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Box,
  Banner,
  Thumbnail,
  Tag,
  Tabs,
  RangeSlider,
  FormLayout,
  Icon,
  Modal,
  Badge,
} from "@shopify/polaris";
import { LockIcon } from "@shopify/polaris-icons";

export async function loader({ request }) {
  const { authenticate } = await import("../shopify.server");
  const { admin } = await authenticate.admin(request);
  
  const allowed = await checkLimit(request, "coupons");
  const designAllowed = await checkDesignLimit(request);
  
  let productCount = 0;
  try {
      const response = await admin.graphql(`
        query { productsCount { count } }
      `);
      const data = await response.json();
      productCount = data?.data?.productsCount?.count || 0;
  } catch (e) { console.error("Failed to fetch product count", e); }

  return json({ allowed, designAllowed, productCount });
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const { validateShopifyDiscount, createCoupon } = await import("../models/coupon.server");
  const allowed = await checkLimit(request, "coupons");
  if (!allowed) {
      return json({ errors: { base: "Limit reached" } }, { status: 403 });
  }
  const formData = await request.formData();

  const offerTitle = formData.get("offerTitle");
  const couponCode = formData.get("couponCode");
  const description = formData.get("description");
  const startTime = formData.get("startTime");
  const endTime = formData.get("endTime");
  const productsStr = formData.get("products");

  const errors = {};
  if (!offerTitle) errors.offerTitle = "Offer title is required";
  if (!couponCode) errors.couponCode = "Coupon code is required";
  if (!startTime) errors.startTime = "Start time is required";
  if (!endTime) errors.endTime = "End time is required";

  if (Object.keys(errors).length > 0) {
    return json({ errors });
  }

  // Shopify Discount Validation
  const forceSave = formData.get("forceSave") === "true";
  const validation = await validateShopifyDiscount(couponCode, admin);
  
  if (!validation.ok) {
    if (validation.isVerificationError && forceSave) {
        // Skip validation and proceed
    } else {
        return json({ 
            errors: { couponCode: validation.message }, 
            isVerificationError: !!validation.isVerificationError 
        }, { status: 400 });
    }
  }

  const products = JSON.parse(productsStr || "[]");

  const styleStr = formData.get("style");
  const style = JSON.parse(styleStr || "{}");
  const preset = style.preset || "standard";
  
  // Design Gating: Only "standard" and "minimal" are free/basic.
  // "neon", "gold", "glass", "ticket" (and potentially others) are Premium.
  const isPremiumPreset = !["standard", "minimal"].includes(preset);
  
  if (isPremiumPreset) {
      const designAllowed = await checkDesignLimit(request);
      if (!designAllowed) {
          return json({ errors: { base: `The "${preset}" design is locked to Growth and Pro plans. Please upgrade or choose Standard/Minimal.` } }, { status: 403 });
      }
  }

  try {
    await createCoupon({
      offerTitle,
      couponCode: couponCode.toUpperCase(),
      description,
      startTime,
      endTime,
      style: styleStr,
      products,
    }, session.shop);

    return redirect("/app/coupons");
  } catch (error) {
    console.error("[createCoupon] failed:", error);
    return json(
      { errors: { base: "Failed to create offer. Please try again." } },
      { status: 500 }
    );
  }
}

export default function NewCouponPage() {
  const shopify = useAppBridge();
  const submit = useSubmit();
  const navigate = useNavigate();
  const actionData = useActionData();
  const navigation = useNavigation();
  const { allowed, designAllowed, productCount } = useLoaderData();
  const isLoading = navigation.state === "submitting";

  const [isDirty, setIsDirty] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  // Wrap setters to mark dirty
  const dirty = (setter) => (val) => { setIsDirty(true); setter(val); };

  const [selectedTab, setSelectedTab] = useState(0);
  const [offerTitle, setOfferTitle] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [endTime, setEndTime] = useState("23:59");
  
  // Applies To State
  const [appliesToType, setAppliesToType] = useState("products"); // products, collections, tags, vendors, all
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedVendors, setSelectedVendors] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [vendorInput, setVendorInput] = useState("");
  const [priority, setPriority] = useState("0");

  // Styling State
  const [stylePreset, setStylePreset] = useState("standard");
  const [styleConfig, setStyleConfig] = useState({
    backgroundColor: "#ffffff",
    borderColor: "#e3e3e3",
    textColor: "#202223",
    codeColor: "#111111",
    borderRadius: 8,
    fontSize: 14,
    typography: "Inter",
    borderStyle: "solid",
    showIcon: true,
  });

  const tabs = [
    { id: "coupon", content: "Offer Details" },
    { id: "style", content: "Visual Style" },
  ];

  const PRESETS = {
    standard: {
      backgroundColor: "#ffffff",
      borderColor: "#e1e3e5",
      textColor: "#202223",
      codeColor: "#111111",
      borderRadius: 8,
      borderStyle: "solid",
      className: "",
    },
    neon: {
      backgroundColor: "#000000",
      borderColor: "#00ffff",
      textColor: "#00ffff",
      codeColor: "#ffffff",
      borderRadius: 4,
      borderStyle: "solid",
      className: "coupon-neon",
    },
    gold: {
      backgroundColor: "linear-gradient(135deg, #bf953f, #fcf6ba, #b38728)",
      borderColor: "#aa771c",
      textColor: "#3e2b00",
      codeColor: "#ffffff",
      borderRadius: 12,
      borderStyle: "solid",
      className: "coupon-gold",
    },
    glass: {
      backgroundColor: "rgba(255, 255, 255, 0.15)",
      borderColor: "rgba(255, 255, 255, 0.3)",
      textColor: "#000000",
      codeColor: "#000000",
      borderRadius: 16,
      borderStyle: "solid",
      className: "coupon-glass",
    },
    minimal: {
      backgroundColor: "#ffffff",
      borderColor: "#111111",
      textColor: "#111111",
      codeColor: "#111111",
      borderRadius: 0,
      borderStyle: "solid",
      className: "coupon-minimal-luxe",
    },
    ticket: {
      backgroundColor: "#ffffff",
      borderColor: "#e1e3e5",
      textColor: "#202223",
      codeColor: "#111111",
      borderRadius: 4,
      borderStyle: "dashed",
      className: "ticket-stub",
      premium: true,
    }
  };

  const PRESET_META = {
    standard: { premium: false },
    neon: { premium: true },
    gold: { premium: true },
    glass: { premium: true },
    minimal: { premium: false },
    ticket: { premium: true },
  };

  const handlePresetChange = (presetKey) => {
    if (PRESET_META[presetKey]?.premium && !designAllowed) {
      setShowUpgradeModal(true);
      return;
    }
    dirty(setStylePreset)(presetKey);
    const p = PRESETS[presetKey];
    dirty(setStyleConfig)(prev => ({ ...prev, ...p }));
  };

  const selectProducts = async () => {
    const response = await shopify.resourcePicker({ type: "product", multiple: true });
    if (response) {
      dirty(setSelectedProducts)(response.map(p => ({
        productId: p.id,
        productTitle: p.title,
        image: p.images[0]?.originalSrc || null,
      })));
    }
  };

  const selectCollections = async () => {
    const response = await shopify.resourcePicker({ type: "collection", multiple: true });
    if (response) {
      dirty(setSelectedCollections)(response.map(c => ({
        id: c.id,
        title: c.title,
        image: c.image?.originalSrc || null,
      })));
    }
  };

  const handleSubmit = (force = false) => {
    setIsDirty(false);
    // 1. Validate Required Fields
    if (!offerTitle.trim()) {
      shopify.toast.show("Offer Title is required", { isError: true });
      return;
    }
    if (!couponCode.trim()) {
      shopify.toast.show("Coupon Code is required", { isError: true });
      return;
    }
    if (!startDate || !endDate) {
      shopify.toast.show("Please select start and end dates", { isError: true });
      return;
    }
    if (!startTime || !endTime) {
      shopify.toast.show("Please select start and end times", { isError: true });
      return;
    }

    const startDateTime = `${startDate}T${startTime}:00`;
    const endDateTime = `${endDate}T${endTime}:00`;

    const formData = new FormData();
    formData.append("offerTitle", offerTitle);
    formData.append("couponCode", couponCode);
    formData.append("description", description);
    formData.append("priority", priority);
    formData.append("startTime", startDateTime);
    formData.append("endTime", endDateTime);
    
    const appliesTo = {
      type: appliesToType,
      products: selectedProducts,
      collections: selectedCollections,
      tags: selectedTags,
      vendors: selectedVendors,
    };

    const finalStyle = {
      ...styleConfig,
      preset: stylePreset,
      selection: appliesTo,
    };
    formData.append("style", JSON.stringify(finalStyle));
    formData.append("products", JSON.stringify(appliesTo));
    
    if (force === true) {
        formData.append("forceSave", "true");
    }

    submit(formData, { method: "post" });
  };

  const PremiumToggle = ({ options, value, onChange }) => (
    <div className="toggle-container">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`toggle-btn ${value === opt.value ? "active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const ColorInput = ({ label, value, onChange }) => (
    <div style={{ flex: 1 }}>
      <TextField
        label={label}
        value={value}
        onChange={(v) => { if(!designAllowed) setShowUpgradeModal(true); else onChange(v); }}
        autoComplete="off"
        prefix={
          <div style={{ position: "relative", width: 24, height: 24 }}>
             <div style={{ position: "absolute", inset: 0, background: value, borderRadius: 4, border: "1px solid #ddd" }} />
             <input
                type="color"
                value={value?.includes('gradient') ? "#ffffff" : value}
                onChange={(e) => { if(!designAllowed) setShowUpgradeModal(true); else onChange(e.target.value); }}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
             />
          </div>
        }
      />
    </div>
  );

  const renderCouponTab = () => (
    <BlockStack gap="400" className="animate-fade-in-up stagger-1">
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingSm">Offer Details</Text>
          <TextField
              label="Offer title"
              value={offerTitle}
              onChange={dirty(setOfferTitle)}
              autoComplete="off"
              placeholder="e.g. Buy 1 Get 1 Free"
              error={actionData?.errors?.offerTitle}
          />
          <TextField
              label="Coupon code"
              value={couponCode}
              onChange={setCouponCode}
              autoComplete="off"
              placeholder="e.g. BYG1"
              helpText="Enter an existing Shopify discount code. Adloom displays this code but does not create the discount in Shopify."
              error={actionData?.errors?.couponCode}
              monospaced
          />
          <TextField
              label="Description (optional)"
              value={description}
              onChange={setDescription}
              autoComplete="off"
              multiline={2}
          />
          <TextField
              label="Display Priority"
              type="number"
              value={priority}
              onChange={dirty(setPriority)}
              autoComplete="off"
              helpText="Lower numbers appear first. Example: 0 appears before 5."
              min={0}
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingSm">Schedule</Text>
          <FormLayout>
            <FormLayout.Group>
               <TextField label="Start date" type="date" value={startDate} onChange={dirty(setStartDate)} autoComplete="off" />
               <TextField label="Start time" type="time" value={startTime} onChange={dirty(setStartTime)} autoComplete="off" />
            </FormLayout.Group>
            <FormLayout.Group>
               <TextField label="End date" type="date" value={endDate} onChange={dirty(setEndDate)} autoComplete="off" />
               <TextField label="End time" type="time" value={endTime} onChange={dirty(setEndTime)} autoComplete="off" />
            </FormLayout.Group>
          </FormLayout>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingSm">Applies To</Text>
          <PremiumToggle
            value={appliesToType}
            onChange={dirty(setAppliesToType)}
            options={[
              { label: "Products", value: "products" },
              { label: "Collections", value: "collections" },
              { label: "Tags", value: "tags" },
              { label: "Vendors", value: "vendors" },
              { label: "Whole Store", value: "all" },
            ]}
          />
          
          {appliesToType === "all" && (
            <Banner tone="warning">
              This offer will appear on all product pages. Use this only for store-wide campaigns.
            </Banner>
          )}
          <Box paddingBlockStart="200">
            {appliesToType === "products" && (
              <BlockStack gap="300">
                <Button onClick={selectProducts}>Browse Products</Button>
                <ResourceScrollArea items={selectedProducts} onRemove={(id) => dirty(setSelectedProducts)(prev => prev.filter(p => p.productId !== id))} idKey="productId" titleKey="productTitle" />
              </BlockStack>
            )}
            {appliesToType === "collections" && (
              <BlockStack gap="300">
                <Button onClick={selectCollections}>Browse Collections</Button>
                <ResourceScrollArea items={selectedCollections} onRemove={(id) => setSelectedCollections(prev => prev.filter(c => c.id !== id))} idKey="id" titleKey="title" />
              </BlockStack>
            )}
            {appliesToType === "tags" && (
              <BlockStack gap="300">
                <TextField
                  label="Enter Tags"
                  placeholder="sale, hot, winter"
                  value={tagInput}
                  onChange={setTagInput}
                  connectedRight={<Button variant="primary" onClick={() => { if(tagInput) { setSelectedTags(prev => [...new Set([...prev, ...tagInput.split(',').map(t => t.trim())])]); setTagInput(""); } }}>Add</Button>}
                  autoComplete="off"
                />
                <InlineStack gap="200">
                  {selectedTags.map(tag => <Tag key={tag} onRemove={() => setSelectedTags(prev => prev.filter(t => t !== tag))}>{tag}</Tag>)}
                </InlineStack>
              </BlockStack>
            )}
            {appliesToType === "vendors" && (
              <BlockStack gap="300">
                 <TextField
                  label="Enter Vendors"
                  placeholder="Apple, Nike"
                  value={vendorInput}
                  onChange={setVendorInput}
                  connectedRight={<Button variant="primary" onClick={() => { if(vendorInput) { setSelectedVendors(prev => [...new Set([...prev, ...vendorInput.split(',').map(v => v.trim())])]); setVendorInput(""); } }}>Add</Button>}
                  autoComplete="off"
                />
                <InlineStack gap="200">
                  {selectedVendors.map(v => <Tag key={v} onRemove={() => setSelectedVendors(prev => prev.filter(t => t !== v))}>{v}</Tag>)}
                </InlineStack>
              </BlockStack>
            )}
            {appliesToType === "all" && (
              <Box paddingBlockStart="200">
                <Banner tone="warning">
                  <p>This offer will appear on all product pages. Use this only for store-wide campaigns.</p>
                  <p>This offer will apply to <strong>{productCount} products</strong> across your store.</p>
                </Banner>
              </Box>
            )}
          </Box>
        </BlockStack>
      </Card>
    </BlockStack>
  );

  const renderStyleTab = () => (
     <BlockStack gap="400" className="animate-fade-in-up">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingSm">Design Presets</Text>
            <Box paddingBlockStart="200">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                {Object.keys(PRESETS).map(key => (
                  <div 
                    key={key} 
                    onClick={() => handlePresetChange(key)}
                    style={{ 
                      padding: "12px", 
                      borderRadius: "12px", 
                      border: `2px solid ${stylePreset === key ? "var(--p-color-border-interactive)" : "transparent"}`,
                      background: "var(--p-color-bg-surface-secondary)",
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all 0.2s",
                      position: "relative"
                    }}
                  >
                    {PRESET_META[key]?.premium && !designAllowed && (
                        <div style={{ position: "absolute", top: "5px", right: "5px", color: "#6d7175" }}>
                            <Icon source={LockIcon} tone="subdued" />
                        </div>
                    )}
                    <div 
                      className={`${PRESETS[key].className || ""}`}
                      style={{ 
                         width: "100%", height: "40px", 
                         borderRadius: `${PRESETS[key].borderRadius || 4}px`, 
                         marginBottom: "8px", 
                         border: `${PRESETS[key].borderStyle || "solid"} 1px ${PRESETS[key].borderColor || "#ddd"}`,
                         background: PRESETS[key].backgroundColor,
                         display: "flex", alignItems: "center", justifyContent: "center",
                         color: PRESETS[key].textColor,
                         fontSize: "10px", fontWeight: "bold",
                         position: "relative",
                         overflow: PRESETS[key].className?.includes("ticket") ? "visible" : "hidden",
                       }}>
                         ABC10
                    </div>
                    <Text variant="bodyXs" fontWeight="medium">{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
                  </div>
                ))}
              </div>
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
                <Text as="h2" variant="headingSm">Manual Customization</Text>
                {!designAllowed && <Badge tone="attention">Pro Feature</Badge>}
            </InlineStack>
            <Box paddingBlockStart="200" style={{ opacity: designAllowed ? 1 : 0.6, pointerEvents: designAllowed ? 'auto' : 'none' }}>
                <FormLayout>
                <FormLayout.Group>
                    <ColorInput label="Background" value={styleConfig.backgroundColor} onChange={(v) => dirty(setStyleConfig)(s => ({ ...s, backgroundColor: v }))} />
                    <ColorInput label="Border" value={styleConfig.borderColor} onChange={(v) => dirty(setStyleConfig)(s => ({ ...s, borderColor: v }))} />
                </FormLayout.Group>
                <FormLayout.Group>
                    <ColorInput label="Text Color" value={styleConfig.textColor} onChange={(v) => dirty(setStyleConfig)(s => ({ ...s, textColor: v }))} />
                    <ColorInput label="Code Color" value={styleConfig.codeColor} onChange={(v) => dirty(setStyleConfig)(s => ({ ...s, codeColor: v }))} />
                </FormLayout.Group>
                <FormLayout.Group>
                    <Select
                    label="Typography"
                    options={["Inter", "Roboto", "Monospace", "Serif", "Outfit"].map(f => ({ label: f, value: f }))}
                    value={styleConfig.typography}
                    onChange={(v) => dirty(setStyleConfig)(s => ({ ...s, typography: v }))}
                    />
                    <Select
                    label="Border Style"
                    options={[
                        { label: "Solid", value: "solid" },
                        { label: "Dashed", value: "dashed" },
                        { label: "Dotted", value: "dotted" },
                        { label: "Double", value: "double" },
                    ]}
                    value={styleConfig.borderStyle}
                    onChange={(v) => dirty(setStyleConfig)(s => ({ ...s, borderStyle: v }))}
                    />
                </FormLayout.Group>
                <RangeSlider
                    label="Corner Radius"
                    value={styleConfig.borderRadius}
                    onChange={(v) => dirty(setStyleConfig)(s => ({ ...s, borderRadius: v }))}
                    min={0} max={30} output
                />
                <RangeSlider
                    label="Font Size"
                    value={styleConfig.fontSize}
                    onChange={(v) => dirty(setStyleConfig)(s => ({ ...s, fontSize: v }))}
                    min={12} max={24} output
                />
                </FormLayout>
            </Box>
          </BlockStack>
        </Card>
     </BlockStack>
  );

  return (
    <Page title="Advanced Offer Builder" backAction={{ url: "/app/coupons" }}>
      <DirtyStateModal isDirty={isDirty} />
      <ActionErrorModal />
      {actionData?.errors && (
        <Box paddingBlockEnd="400">
          <Banner tone="critical" title="Cannot save offer">
             <List>
               {Object.values(actionData.errors).map((err, i) => <List.Item key={i}>{err}</List.Item>)}
             </List>
          </Banner>
        </Box>
      )}
      {!allowed && <Banner tone="warning" title="Limit Reached" marginBottom="400">Upgrade to create more offers.</Banner>}
      
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box padding="500">
                {selectedTab === 0 ? renderCouponTab() : renderStyleTab()}
              </Box>
            </Tabs>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card title="Live Preview" className="elite-card">
              <BlockStack gap="400">
                <Text variant="headingSm">Live Preview</Text>
                <div style={{ padding: "10px 0" }}>
                   <div 
                    className={`rockit-coupon-card is-expanded ${PRESETS[stylePreset]?.className || ""}`}
                    style={{
                      "--rc-bg": styleConfig.backgroundColor || "#fafafa",
                      "--rc-border": styleConfig.borderColor || "#e3e3e3",
                      "--rc-text": styleConfig.textColor || "#1a1a1a",
                      borderStyle: styleConfig.borderStyle || "solid",
                      borderRadius: `${styleConfig.borderRadius || 8}px`,
                      fontFamily: styleConfig.typography || "inherit",
                    }}
                   >
                      <div className="rockit-coupon-header">
                        <div className="rockit-coupon-header-left">
                          <div className="rockit-coupon-icon">
                            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                            <div className="rockit-percent-badge">%</div>
                          </div>
                          <div className="rockit-coupon-info">
                            <div className="rockit-coupon-offer">{offerTitle || "Your Offer Title"}</div>
                            {description && <div className="rockit-coupon-desc">{description}</div>}
                          </div>
                        </div>
                        <div className="rockit-coupon-chevron">
                           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </div>
                      </div>
                      <div className="rockit-coupon-body">
                        <div className="rockit-coupon-body-content">
                          <span className="rockit-coupon-code" style={{ 
                             border: "1px solid var(--rc-border)", 
                             color: styleConfig.codeColor || "var(--rc-text)", 
                             background: styleConfig.backgroundColor === "#ffffff" ? "#fdfdfd" : "#ffffff", 
                             fontSize: `${styleConfig.fontSize || 13}px` 
                          }}>{couponCode || "GIFT10"}</span>
                          <button type="button" className="rockit-btn-copy-text" style={{ color: styleConfig.codeColor }}>Copy Code</button>
                        </div>
                      </div>
                   </div>
                </div>
              </BlockStack>
            </Card>

            <Button
              variant="primary"
              size="large"
              fullWidth
              onClick={handleSubmit}
              loading={isLoading}
              disabled={!allowed}
            >
              Create Offer
            </Button>
            
            {actionData?.isVerificationError && (
               <Box paddingBlockStart="200">
                 <Button
                   variant="tertiary"
                   fullWidth
                   onClick={() => handleSubmit(true)}
                 >
                   Save anyway
                 </Button>
               </Box>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
      <Modal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        title="Upgrade to Unlock Premium Designs"
        primaryAction={{
          content: "View Plans",
          onAction: () => navigate("/app/pricing"),
        }}
        secondaryActions={[
          {
            content: "Maybe Later",
            onAction: () => setShowUpgradeModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="info">
               <p>Custom styles and premium presets are included in the **Growth** and **Pro** plans.</p>
            </Banner>
            <Text as="p">
              Impress your customers with high-converting designs, unique layouts, and custom branding tailored to your store's identity.
            </Text>
            <BlockStack gap="200">
               <InlineStack gap="200"><Icon source={LockIcon} tone="success" /><Text as="span">Neon, Gold & Glass Styles</Text></InlineStack>
               <InlineStack gap="200"><Icon source={LockIcon} tone="success" /><Text as="span">Full Design Customization</Text></InlineStack>
               <InlineStack gap="200"><Icon source={LockIcon} tone="success" /><Text as="span">Custom Google Fonts</Text></InlineStack>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function ResourceScrollArea({ items, onRemove, idKey, titleKey }) {
  if (items.length === 0) return null;
  return (
    <Box padding="200" background="bg-surface-secondary" borderRadius="300" maxHeight="200px" style={{ overflowY: "auto" }}>
      <BlockStack gap="200">
        {items.map(item => (
          <Box key={item[idKey]} padding="200" background="bg-surface" borderRadius="200" border="1px solid #eee">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                {item.image && <Thumbnail source={item.image} size="small" />}
                <Text variant="bodySm" fontWeight="medium">{item[titleKey]}</Text>
              </InlineStack>
              <Button size="micro" variant="plain" tone="critical" onClick={() => onRemove(item[idKey])}>Remove</Button>
            </InlineStack>
          </Box>
        ))}
      </BlockStack>
    </Box>
  );
}
