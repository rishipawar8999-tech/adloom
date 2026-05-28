import { useState, useEffect } from "react";
import { Page, Layout, Text, BlockStack, InlineStack, Button, Icon, Divider, Box, Banner, Modal } from "@shopify/polaris";
import { StarFilledIcon } from "@shopify/polaris-icons";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useLocation, useNavigate } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getPlanUsage, getPlan } from "../models/billing.server";
import { Tooltip } from "@shopify/polaris";

const TIERS = { "Free": 0, "Basic": 1, "Growth": 2, "Pro": 3 };
function getTier(planName) {
  if (!planName) return TIERS.Free;
  if (planName.includes("Pro")) return TIERS.Pro;
  if (planName.includes("Growth")) return TIERS.Growth;
  if (planName.includes("Basic")) return TIERS.Basic;
  return TIERS.Free;
}
function isAnnual(planName) {
  return planName ? planName.includes("Annual") : false;
}
function validateTransition(current, target) {
  if (current === "Free" || !current) return { valid: true };
  if (current === target) return { valid: false, reason: "Active Plan" };

  const currentAnn = isAnnual(current);
  const targetAnn = isAnnual(target);

  if (currentAnn && !targetAnn) {
    return { valid: false, reason: "Cannot switch directly from Annual to Monthly." };
  }
  return { valid: true };
}

export async function loader({ request }) {
  await authenticate.admin(request);
  const usage = await getPlanUsage(request);
  const url = new URL(request.url);
  
  // Verify that they actually upgraded (declined charges will still have upgraded=true in the URL)
  const hasUpgradedParam = url.searchParams.get("upgraded") === "true" || url.searchParams.get("celebrate") === "true";
  const actuallyUpgraded = hasUpgradedParam && usage.plan !== "Free";
  const cancelled = url.searchParams.get("cancelled") === "true";
  
  return json({ usage, celebrate: actuallyUpgraded, cancelled, planName: usage.plan });
}

export async function action({ request }) {
  const { billing, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const plan = formData.get("plan");

  // Free plan has no charge — redirect to cancel/downgrade page
  if (!plan || plan === "Free") {
    return redirect("/app/cancel");
  }

  const currentPlan = (await getPlan(request)).plan;
  const transition = validateTransition(currentPlan, plan);
  if (!transition.valid && transition.reason !== "Active Plan") {
    return json({ 
      error: "Invalid Plan Transition", 
      details: "Invalid transition."
    }, { status: 400 });
  }

  console.log(`[Billing Debug] Action started for shop: ${shop}`);
  console.log(`[Billing Debug] Form data plan: ${plan}`);

  const url = new URL(request.url);
  // isTest: true = no real charge (safe for development stores & smoke testing)
  // Set BILLING_TEST_MODE=true on Railway to test without real payments.
  // Remove it before going live to real merchants.
  const isTest =
    process.env.BILLING_TEST_MODE === "true" ||
    process.env.NODE_ENV !== "production";

  // Point returnUrl at our unauthenticated /billing-return bounce route.
  // This route lives OUTSIDE the /app tree so it won't trigger authenticate.admin().
  // It reads the shop param and redirects the browser into the Shopify Admin
  // iframe, where App Bridge provides the session token automatically.
  let appUrl = process.env.SHOPIFY_APP_URL || url.origin;
  if (appUrl.endsWith("/")) appUrl = appUrl.slice(0, -1);
  const shopParam = url.searchParams.get("shop") || shop;
  const returnUrl = `${appUrl}/billing-return?upgraded=true&plan=${encodeURIComponent(plan)}&shop=${shopParam}`;

  console.log(`[Billing] shop=${shop} plan=${plan} isTest=${isTest} returnUrl=${returnUrl}`);

  try {
    const { trialDaysRemaining, hasEverPurchased } = await getPlan(request);
    
    let trialDays = undefined;
    if (hasEverPurchased) {
      trialDays = Math.max(0, trialDaysRemaining);
    }

    console.log(`[Billing Request] shop=${shop} plan=${plan} hasEverPurchased=${hasEverPurchased} trialDaysRemaining=${trialDaysRemaining} passing trialDays=${trialDays}`);

    const confirmation = await billing.request({
      plan,
      isTest,
      returnUrl,
      ...(trialDays !== undefined ? { trialDays } : {}),
    });

    // confirmation.confirmationUrl is the Shopify-hosted page with the Approve button.
    // We MUST redirect there — returning the object directly breaks the flow.
    return redirect(confirmation.confirmationUrl);
  } catch (error) {
    // The Shopify billing API throws a Response redirect on success in some SDK versions.
    // Re-throw it so Remix handles the redirect correctly.
    if (error instanceof Response) {
      throw error;
    }
    console.error("[Billing] error:", error.message);
    return json(
      { error: error.message || "Billing error", details: { name: error.name } },
      { status: 500 }
    );
  }
}

const premiumStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  :root {
    --loom-primary: #000000;
    --loom-bg: #ffffff;
    --loom-border: #e1e3e5;
    --loom-subdued: #6d7175;
    --loom-shadow-sm: 0 2px 4px rgba(0,0,0,0.05);
    --loom-shadow-md: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1);
    --loom-shadow-lg: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
  }

  .pricing-container {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  }

  .minimal-usage-card {
    background: #ffffff;
    border: 1px solid var(--loom-border);
    border-radius: 16px;
    box-shadow: var(--loom-shadow-sm);
  }

  .minimal-plan-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border: 1px solid var(--loom-border);
    border-radius: 20px;
    background: #ffffff;
    position: relative;
    /* overflow: hidden removed to prevent clipping */
  }

  .minimal-plan-card:hover {
    transform: translateY(-8px);
    border-color: #000000;
    box-shadow: var(--loom-shadow-lg);
  }

  .highlight-pro {
    border: 2px solid #000000 !important;
    transform: scale(1.02);
    z-index: 10;
    box-shadow: var(--loom-shadow-md);
  }

  .highlight-pro:hover {
     transform: scale(1.02) translateY(-8px);
  }

  .plan-badge-exclusive {
    background: #000000;
    color: white;
    padding: 6px 14px;
    border-radius: 100px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: absolute;
    top: -12px;
    right: 20px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
    z-index: 20;
  }

  .toggle-container-premium {
    background: #f4f4f5;
    padding: 6px;
    border-radius: 14px;
    display: inline-flex;
    gap: 2px;
    border: 1px solid #e4e4e7;
  }

  .toggle-btn-premium {
    padding: 10px 24px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    font-family: inherit;
  }

  .toggle-btn-premium.active {
    background: #ffffff;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    color: #000000;
  }

  .toggle-btn-premium.inactive {
    background: transparent;
    color: #71717a;
  }

  .toggle-btn-premium.inactive:hover {
    color: #18181b;
  }

  .feature-icon-wrapper {
    background: #f4f4f5;
    border-radius: 50%;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .premium-button-growth {
    background: linear-gradient(135deg, #000000 0%, #333333 100%) !important;
    border: none !important;
    color: white !important;
  }
  
  .premium-button-growth:hover {
    background: linear-gradient(135deg, #222222 0%, #444444 100%) !important;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3) !important;
  }
`;

function UsageBar({ label, used, limit }) {
  const percent = limit === Infinity ? 0 : Math.min((used / limit) * 100, 100);
  const color = percent > 90 ? "#DC2626" : (percent > 70 ? "#F59E0B" : "#000000");
  
  return (
    <BlockStack gap="150">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text as="span" variant="bodyXs" fontWeight="semibold" tone="subdued">{label}</Text>
        <div style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
            <Text as="span" variant="bodySm" fontWeight="bold" tone={percent > 90 ? "critical" : undefined}>{used}</Text>
            <Text as="span" variant="bodyXs" tone="subdued">/ {limit === Infinity ? "∞" : limit}</Text>
        </div>
      </div>
      <div style={{ height: "6px", background: "#f1f1f5", borderRadius: "100px", overflow: "hidden" }}>
        <div style={{ 
          width: `${percent}%`, 
          height: "100%", 
          background: color, 
          borderRadius: "100px",
          transition: "width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)"
        }} />
      </div>
    </BlockStack>
  );
}

function PlanCard({ plan, currentPlan, onDowngradeRequest }) {
  const submit = useSubmit();
  const navigate = useNavigate();
  const isCurrent = plan.id === currentPlan;
  const transition = validateTransition(currentPlan, plan.id);
  const isDisabled = isCurrent || !transition.valid;
  
  const isDowngrade = getTier(plan.id) < getTier(currentPlan) && !isAnnual(plan.id);
  const label = isCurrent ? "Current Plan" : (isDowngrade ? "Downgrade" : plan.buttonLabel);
  
  const handleSelect = () => {
    // Free plan doesn't go through billing.request — navigate to cancel instead.
    // MUST use Remix navigate to preserve App Bridge session token!
    if (plan.id === "Free") {
      navigate("/app/cancel");
      return;
    }
    if (isDowngrade) {
      onDowngradeRequest(plan.id);
      return;
    }
    submit({ plan: plan.id }, { method: "post" });
  };

  return (
    <div className={`minimal-plan-card ${plan.highlighted ? 'highlight-pro' : ''}`} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {plan.badge && <div className="plan-badge-exclusive">{plan.badge}</div>}
      
      <Box padding="600" style={{ flexGrow: 1 }}>
        <BlockStack gap="600">
          <BlockStack gap="400" align="center">
            <BlockStack gap="100" align="center">
              <Text as="h3" variant="headingMd" fontWeight="bold" alignment="center">
                {plan.name}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued" fontWeight="medium" alignment="center">{plan.description}</Text>
            </BlockStack>
            
            <div style={{ display: "flex", gap: "4px", alignItems: "baseline", marginTop: "4px", justifyContent: "center" }}>
              <span style={{ fontSize: "32px", fontWeight: "800", letterSpacing: "-0.02em" }}>{plan.price}</span>
              {plan.period && <Text as="span" variant="bodySm" tone="subdued" fontWeight="medium">{plan.period}</Text>}
            </div>
          </BlockStack>

          <Divider />

          <BlockStack gap="300">
            {plan.features.map((feature, i) => {
              const isVariant = feature.toLowerCase().includes("variant");
              return (
                <div key={i} style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                  <Text 
                    as="span" 
                    variant={isVariant ? "bodyMd" : "bodySm"} 
                    tone={isVariant ? "base" : "subdued"} 
                    fontWeight={isVariant ? "bold" : "medium"}
                    alignment="center"
                  >
                    {feature}
                  </Text>
                </div>
              );
            })}
          </BlockStack>
        </BlockStack>
      </Box>

      <Box padding="600" paddingBlockStart="0">
        <BlockStack gap="300">
          {plan.trial && (
             <Text as="p" variant="bodyXs" alignment="center" tone="subdued" fontWeight="semibold">✨ {plan.trial}</Text>
          )}
          {!transition.valid && !isCurrent ? (
            <Tooltip content={transition.reason} preferredPosition="above">
              <div>
                <Button
                  variant={plan.highlighted ? "primary" : "secondary"}
                  fullWidth
                  disabled={isDisabled}
                  onClick={handleSelect}
                  size="large"
                  className={plan.highlighted ? "premium-button-growth" : ""}
                >
                  {label}
                </Button>
              </div>
            </Tooltip>
          ) : (
            <Button
              variant={plan.highlighted ? "primary" : "secondary"}
              fullWidth
              disabled={isDisabled}
              onClick={handleSelect}
              size="large"
              className={plan.highlighted ? "premium-button-growth" : ""}
            >
              {label}
            </Button>
          )}
        </BlockStack>
      </Box>
    </div>
  );
}

// ... PlanBenefits removed or updated if used ...

function CelebrationModal({ isOpen, onClose, planName, navigate }) {
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="🎉 You're Upgraded!"
      primaryAction={{
        content: "Create Your First Sale →",
        onAction: () => navigate("/app/sales/new"),
      }}
      secondaryActions={[
        {
          content: "Visit Help Center",
          onAction: () => navigate("/app/help"),
        }
      ]}
    >
      <Modal.Section>
        <BlockStack gap="500">
          <Box padding="600" background="bg-surface-secondary" borderRadius="400">
            <BlockStack gap="400" align="center">
              <div style={{ 
                background: "linear-gradient(135deg, #dcfce7 0%, #bcfabf 100%)", 
                padding: "20px", 
                borderRadius: "50%",
                display: "flex",
                boxShadow: "0 10px 15px -3px rgba(34, 197, 94, 0.2)"
              }}>
                <Icon source={StarFilledIcon} tone="success" />
              </div>
              <BlockStack gap="100" align="center">
                <Text as="h2" variant="headingLg" fontWeight="bold">
                  Thank you for choosing Loom!
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                  Your <Text as="span" fontWeight="bold">{planName} Plan</Text> is now active. You have unlocked all premium features to validy boost your sales.
                </Text>
              </BlockStack>
            </BlockStack>
          </Box>

          <Divider />

          <BlockStack gap="200" align="center">
             <Text as="p" variant="bodySm" tone="subdued" alignment="center">
               Need assistance? <Button variant="plain" url="mailto:Hello@adloomx.com">Hello@adloomx.com</Button>
             </Text>
          </BlockStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

export default function PricingPage() {
  const { usage, celebrate, cancelled, planName } = useLoaderData();
  const actionData = useActionData();
  const location = useLocation();
  const shopify = useAppBridge();
  const currentPlan = usage?.plan || "Free";
  const hasEverPurchased = usage?.hasEverPurchased || false;
  const trialDaysRemaining = usage?.trialDaysRemaining || 0;
  const activeFrom = usage?.activeFrom;
  const currentPeriodEnd = usage?.currentPeriodEnd;
  const [isYearly, setIsYearly] = useState(false);
  const [showCelebrate, setShowCelebrate] = useState(false);
  const [showDowngradeModal, setShowDowngradeModal] = useState(false);
  const [pendingDowngrade, setPendingDowngrade] = useState(null);
  const navigate = useNavigate();
  const submit = useSubmit();

  useEffect(() => {
    if (celebrate) {
      setShowCelebrate(true);
      window.history.replaceState({}, "", location.pathname);
    }
  }, [celebrate, location.pathname]);

  useEffect(() => {
    if (cancelled) {
      setShowDowngradeModal(true);
      window.history.replaceState({}, "", location.pathname);
    }
  }, [cancelled, location.pathname]);

  const handleDowngradeRequest = (planId) => {
    setPendingDowngrade(planId);
    setShowDowngradeModal(true);
  };

  const plans = [
    {
      name: "Free",
      id: "Free",
      price: "Free",
      period: "",
      features: [
        "Up to 50 variants",
        "1 Sale limit",
        "5 Active Coupons",
        "2 Countdown Timers",
        "Sale scheduling",
        "Advanced filtering",
        "Price rounding",
      ],
      description: "Perfect for starting out.",
      buttonLabel: "Free Plan",
      highlighted: false,
    },
    {
      name: "Basic",
      id: isYearly ? "Basic Annual" : "Basic",
      price: isYearly ? "$95.90" : "$9.99",
      period: isYearly ? "/yr" : "/mo",
      features: [
        "Up to 500 variants",
        "Unlimited Sales",
        "25 Active Coupons",
        "10 Countdown Timers",
        "Sale scheduling",
        "Early access features",
        "Fast support",
      ],
      description: "For growing stores.",
      // Show trial only if merchant has never purchased; show remaining days if currently trialing
      trial: !hasEverPurchased
        ? (trialDaysRemaining > 0 && currentPlan === "Basic"
            ? `${trialDaysRemaining} days left in trial`
            : "3-day free trial")
        : null,
      buttonLabel: "Choose Basic",
      highlighted: false,
    },
    {
      name: "Growth",
      id: isYearly ? "Growth Annual" : "Growth",
      price: isYearly ? "$191.90" : "$19.99",
      period: isYearly ? "/yr" : "/mo",
      badge: "Popular",
      features: [
        "Up to 1000 variants",
        "Unlimited Sales",
        "Unlimited Coupons",
        "Unlimited Timers",
        "Custom Timer Designs",
        "Priority Support",
      ],
      description: "For established brands.",
      trial: !hasEverPurchased
        ? (trialDaysRemaining > 0 && (currentPlan === "Growth" || currentPlan === "Growth Annual")
            ? `${trialDaysRemaining} days left in trial`
            : "3-day free trial")
        : null,
      buttonLabel: "Choose Growth",
      highlighted: true,
    },
    {
      name: "Pro",
      id: isYearly ? "Pro Annual" : "Pro",
      price: isYearly ? "$287.90" : "$29.99",
      period: isYearly ? "/yr" : "/mo",
      features: [
        "Unlimited variants",
        "Unlimited Sales",
        "Unlimited Coupons",
        "Unlimited Timers",
        "Custom Offer Designs",
        "White-glove setup",
        "Priority Support",
      ],
      description: "For high-volume stores.",
      trial: !hasEverPurchased
        ? (trialDaysRemaining > 0 && (currentPlan === "Pro" || currentPlan === "Pro Annual")
            ? `${trialDaysRemaining} days left in trial`
            : "3-day free trial")
        : null,
      buttonLabel: "Choose Pro",
      highlighted: false,
    },
  ];

  return (
    <Page title="" backAction={{ url: "/app" }}>
      <style>{premiumStyles}</style>
      <CelebrationModal isOpen={showCelebrate} onClose={() => setShowCelebrate(false)} planName={planName} navigate={navigate} />
      
      <Modal
        open={showDowngradeModal}
        onClose={() => {
          setShowDowngradeModal(false);
          setPendingDowngrade(null);
        }}
        title={pendingDowngrade ? "Confirm Downgrade" : "Plan Changed Successfully"}
        primaryAction={{
          content: pendingDowngrade ? "Confirm Downgrade" : "Okay",
          onAction: () => {
            if (pendingDowngrade) {
              submit({ plan: pendingDowngrade }, { method: "post" });
              setShowDowngradeModal(false);
              setPendingDowngrade(null);
            } else {
              setShowDowngradeModal(false);
            }
          },
        }}
        secondaryActions={pendingDowngrade ? [
          {
            content: "Cancel",
            onAction: () => {
              setShowDowngradeModal(false);
              setPendingDowngrade(null);
            }
          }
        ] : []}
      >
        <Modal.Section>
          <Text as="p">
            {pendingDowngrade 
              ? "Are you sure you want to downgrade? Your new plan limits will take effect at the end of your current billing cycle." 
              : "Your plan has been changed successfully. Because Shopify applies billing changes immediately and may issue prorated app credits for unused time, your new plan limits are now active."}
          </Text>
        </Modal.Section>
      </Modal>

      <div className="pricing-container">
        <BlockStack gap="1000">
          <Layout>
            {actionData?.error && (
              <Layout.Section>
                <Banner title={actionData.error} tone="critical" />
              </Layout.Section>
            )}

            <Layout.Section>
              <div className="minimal-usage-card">
                <Box padding="800">
                  <BlockStack gap="600">
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingMd" fontWeight="bold">Account Overview</Text>
                      <Text as="p" variant="bodySm" tone="subdued" fontWeight="medium">
                        Current plan: <Text as="span" fontWeight="bold" tone="base">{currentPlan}</Text>
                      </Text>
                      {currentPlan !== "Free" && activeFrom && currentPeriodEnd && (
                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                          <Text as="p" variant="bodyXs" tone="subdued">
                            Active since: <Text as="span" fontWeight="medium">{new Date(activeFrom).toLocaleDateString()}</Text>
                          </Text>
                          <Text as="p" variant="bodyXs" tone="subdued">
                            Renews on: <Text as="span" fontWeight="medium">{new Date(currentPeriodEnd).toLocaleDateString()}</Text>
                          </Text>
                        </div>
                      )}
                    </BlockStack>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "40px" }}>
                      <UsageBar label="Variant Limit" used={usage.variants?.used} limit={usage.variants?.limit} />
                      <UsageBar label="Sales Limit" used={usage.totalSales?.used} limit={usage.totalSales?.limit} />
                      <UsageBar label="Active Coupons" used={usage.coupons.used} limit={usage.coupons.limit} />
                      <UsageBar label="Active Timers" used={usage.timers.used} limit={usage.timers.limit} />
                    </div>
                  </BlockStack>
                </Box>
              </div>
            </Layout.Section>

            <Layout.Section>
              <BlockStack gap="1000">
                <BlockStack gap="400" align="center">
                  <Text as="h2" variant="headingXl" fontWeight="bold">Simple, transparent pricing</Text>
                  <Text as="p" variant="bodyLg" tone="subdued" alignment="center" fontWeight="medium">
                    Scale your store with the most powerful sales automation engine.
                  </Text>
                  
                  <Box paddingBlockStart="600">
                    <div className="toggle-container-premium">
                      <button 
                        className={`toggle-btn-premium ${!isYearly ? 'active' : 'inactive'}`} 
                        onClick={() => setIsYearly(false)}
                      >
                        Monthly
                      </button>
                      <button 
                        className={`toggle-btn-premium ${isYearly ? 'active' : 'inactive'}`} 
                        onClick={() => setIsYearly(true)}
                      >
                        Yearly <span style={{ color: "#10b981", marginLeft: "4px" }}>(Save 20%)</span>
                      </button>
                    </div>
                  </Box>
                </BlockStack>
    
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "30px", padding: "10px" }}>
                  {plans.map((plan) => (
                    <PlanCard key={plan.id} plan={plan} currentPlan={currentPlan} onDowngradeRequest={handleDowngradeRequest} />
                  ))}
                </div>
    
                <Box paddingBlockStart="400" paddingBlockEnd="1000" align="center">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" tone="subdued" fontWeight="medium">
                      All payments are securely handled by Shopify.
                    </Text>
                    <InlineStack align="center" gap="100">
                       <Text as="span" variant="bodySm" tone="subdued">Need help choosing?</Text>
                       <Button variant="plain" url="mailto:hello@adloomx.com">Contact Specialist →</Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </div>
    </Page>
  );
}

