import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, useNavigate, useSearchParams, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { XIcon, CheckIcon } from "@shopify/polaris-icons";
import {
  Page,
  Layout,
  Card,
  Button,
  Icon,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  IndexTable,
  Tooltip,
  EmptyState,
  Banner,
  Modal,
  Spinner,
  Tabs,
  useIndexResourceState
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

function timeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 0) {
     // Future
     const absSeconds = Math.abs(seconds);
     if (absSeconds < 60) return "In a few seconds";
     const minutes = Math.floor(absSeconds / 60);
     if (minutes < 60) return `In ${minutes}m`;
     const hours = Math.floor(minutes / 60);
     if (hours < 24) return `In ${hours}h`;
     const days = Math.floor(hours / 24);
     return `In ${days}d`;
  }

  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function loader({ request }) {
  const { authenticate } = await import("../shopify.server");
  const { session } = await authenticate.admin(request);
  const { getSales } = await import("../models/sale.server");
  const { getTimers } = await import("../models/timer.server");
  const { getCoupons } = await import("../models/coupon.server");
  const { getPlanUsage } = await import("../models/billing.server");
  
  try {
    const [sales, timers, coupons, usage] = await Promise.all([
      getSales(session.shop),
      getTimers(session.shop),
      getCoupons(session.shop),
      getPlanUsage(request),
    ]);

    // A reinstalled merchant: they have history but are currently on Free (no active subscription)
    const isReinstall = usage.hasEverPurchased && usage.plan === "Free";

    const db = (await import("../db.server")).default;
    const systemState = await db.systemState.findUnique({ where: { id: "singleton" } });
    const cronLastRun = systemState?.lastCron || null;
    const isBillingTestMode = process.env.BILLING_TEST_MODE === "true";

    return json({ sales, timers, coupons, usage, isReinstall, cronLastRun, isBillingTestMode });
  } catch (error) {
    console.error("Loader failed:", error);
    throw new Response("Failed to load dashboard data", { status: 500 });
  }
}


export async function action({ request }) {
  const { authenticate } = await import("../shopify.server");
  const { session, admin } = await authenticate.admin(request);
  const { revertSale, deleteSale, applySale, getSale, checkItemOverlaps } = await import("../models/sale.server");
  const { checkGlobalVariantLimit } = await import("../models/billing.server");

  const formData = await request.formData();
  const action = formData.get("action");
  const saleId = formData.get("saleId");

  try {
    if (action === "revert" && saleId) {
      await revertSale(saleId, admin);
    } else if (action === "delete" && saleId) {
      await deleteSale(saleId, admin);
    } else if (action === "bulkDeactivate") {
      const ids = formData.get("ids")?.split(",") || [];
      for (const id of ids) {
        await revertSale(id, admin);
      }
    } else if (action === "activate" && saleId) {
      const sale = await getSale(saleId, session.shop);
      if (!sale) return json({ success: false, error: "Sale not found" }, { status: 404 });

      const variantIds = (sale.items || []).map(i => i.variantId);

      // 1. Check for product overlaps
      // Passing startTime/endTime is critical for checking conflicts with other scheduled sales
      const overlapCheck = await checkItemOverlaps(
          session.shop, 
          variantIds, 
          saleId, 
          sale.startTime, 
          sale.endTime, 
          sale.timerId
      );

      if (!overlapCheck.ok) {
          return json({ success: false, error: overlapCheck.message }, { status: 400 });
      }
      
      // 2. Check global variant limit
      const variantLimitCheck = await checkGlobalVariantLimit(
          request,
          variantIds,
          sale.startTime,
          sale.endTime,
          saleId
      );

      if (!variantLimitCheck.ok) {
           return json({ success: false, error: variantLimitCheck.message }, { status: 400 });
      }

      const count = await applySale(saleId, admin);
      return json({ success: true, action, count });
    } else if (action === "bulkDelete") {
      const ids = formData.get("ids")?.split(",") || [];
      for (const id of ids) {
        await deleteSale(id, admin);
      }
    }
    return json({ success: true, action });
  } catch (error) {
    console.error("Action failed:", error);
    return json({ success: false, error: error.message || "An unexpected error occurred" }, { status: 500 });
  }
}

export default function Index() {
  const { sales = [], timers = [], coupons = [], isReinstall = false, cronLastRun, isBillingTestMode } = useLoaderData() || {};
  const actionData = useActionData();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting" || navigation.state === "loading";
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTab, setSelectedTab] = useState(0);
  const shopify = useAppBridge();

  // Launch Track logic
  const [trackDismissed, setTrackDismissed] = useState(false);
  useEffect(() => {
    const dismissed = localStorage.getItem("loom_track_dismissed");
    if (dismissed) setTrackDismissed(true);
  }, []);

  const [cronWarning, setCronWarning] = useState(false);
  useEffect(() => {
    if (!cronLastRun) {
      setCronWarning(true);
    } else {
      const msSince = new Date() - new Date(cronLastRun);
      if (msSince > 15 * 60 * 1000) { // 15 mins
        setCronWarning(true);
      }
    }
  }, [cronLastRun]);

  const milestones = useMemo(() => {
    return [
      {
        id: "placement",
        label: "Customize Placement",
        done: false, // Always false initially, or check if theme app extension is active (hard to do from here)
        actionLabel: "Open Editor",
        url: "https://admin.shopify.com/themes/current/editor",
        external: true,
        target: "_top",
        description: "Position your timers and offers in the theme editor."
      },
      {
        id: "sale",
        label: "Create Your First Sale",
        done: sales.length > 0,
        actionLabel: "Create Sale",
        onAction: () => navigate("/app/sales/new"),
        description: "Launch a store-wide or collection-specific sale."
      },
      {
        id: "timer",
        label: "Add a Countdown Timer",
        done: timers.length > 0,
        actionLabel: "Create Timer",
        onAction: () => navigate("/app/timers/new"),
        description: "Drive urgency with a countdown on your products."
      },
      {
        id: "offer",
        label: "Create an Offer",
        done: coupons.length > 0,
        actionLabel: "Create Offer",
        onAction: () => navigate("/app/coupons/new"), // Assuming coupons route
        description: "Set up a coupon code or special deal."
      }
    ];
  }, [sales, timers, coupons, navigate]);

  const progress = Math.round((milestones.filter(m => m.done).length / milestones.length) * 100);

  const showSuccessBanner = searchParams.get("success") === "true";
  const updatedCount = searchParams.get("count");

  useEffect(() => {
    if (showSuccessBanner) {
      shopify.toast.show(`Sale activated — ${updatedCount} prices updated`);
    }
  }, [showSuccessBanner, updatedCount, shopify]);

  useEffect(() => {
    if (actionData?.success) {
      if (actionData.action === "revert" || actionData.action === "bulkDeactivate") {
        shopify.toast.show("Sale paused successfully");
      } else if (actionData.action === "delete" || actionData.action === "bulkDelete") {
        shopify.toast.show("Sale deleted successfully");
      } else if (actionData.action === "activate") {
        shopify.toast.show(`Sale activated — ${actionData.count} prices updated`);
      } else {
        shopify.toast.show("Action successful");
      }
    } else if (actionData?.error) {
       if (actionData.error.includes("Conflict detected")) {
          setConflictError(actionData.error);
       } else {
          shopify.toast.show(actionData.error, { isError: true });
       }
    }
  }, [actionData, shopify]);

  const dismissBanner = useCallback(() => {
    setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.delete("success");
        newParams.delete("count");
        return newParams;
    });
  }, [setSearchParams]);

  const handleDismissTrack = () => {
    setTrackDismissed(true);
    localStorage.setItem("loom_track_dismissed", "true");
  };

  const LaunchTrack = () => (
    <div className="animate-fade-in-up stagger-1">
      {isReinstall && (
        <Banner
          title="Welcome back! Your account is on the Free plan"
          tone="warning"
          action={{ content: "Choose a plan", url: "/app/pricing" }}
          onDismiss={() => {}}
        >
          <p>
            You previously had a paid subscription. Please select a plan to restore your limits.
            Note: Shopify does not offer a new free trial if you have used one before.
          </p>
        </Banner>
      )}
      <Card padding="500">
      <BlockStack gap="500">
        <InlineStack align="space-between" verticalAlign="center">
          <BlockStack gap="100">
            <Text as="h2" variant="headingLg" fontWeight="bold">Launch Track</Text>
            <Text as="p" variant="bodyMd" tone="subdued">Complete these steps to boost your sales.</Text>
          </BlockStack>
          <InlineStack gap="400" align="center">
            <div style={{ textAlign: "right" }}>
                <Text as="p" variant="heading2xl" fontWeight="bold" tone="highlight">{progress}%</Text>
                <Text as="p" variant="bodyxs" tone="subdued" fontWeight="medium">COMPLETED</Text>
            </div>
            <Button variant="plain" icon={XIcon} onClick={handleDismissTrack} accessibilityLabel="Dismiss" />
          </InlineStack>
        </InlineStack>

        <div style={{ height: "8px", background: "#f3f4f6", borderRadius: "9999px", overflow: "hidden" }}>
          <div style={{ 
            width: `${progress}%`, 
            height: "100%", 
            background: "linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)",
            borderRadius: "9999px",
            transition: "width 0.8s ease-out"
          }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "16px" }}>
          {milestones.map((m) => (
            <div key={m.id} style={{ 
              padding: "16px", 
              borderRadius: "12px", 
              background: m.done ? "#f0fdf4" : "#ffffff",
              border: `1px solid ${m.done ? "#bbf7d0" : "#e5e7eb"}`,
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              justifyContent: "space-between",
              transition: "all 0.2s ease"
            }}>
              <BlockStack gap="200">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                   <div style={{ 
                      width: "20px", 
                      height: "20px", 
                      borderRadius: "50%", 
                      background: m.done ? "#22c55e" : "#f3f4f6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontSize: "12px",
                      flexShrink: 0
                   }}>
                     {m.done ? <Icon source={CheckIcon} tone="white" /> : null}
                   </div>
                   <Text as="span" variant="bodySm" fontWeight={m.done ? "bold" : "semibold"}>{m.label}</Text>
                </div>
                <Text as="p" variant="bodyXs" tone="subdued">{m.description}</Text>
              </BlockStack>
              {!m.done && (
                 <Button 
                   size="slim" 
                   url={m.url} 
                   external={m.external} 
                   target={m.target} 
                   onClick={m.onAction}
                   variant="primary"
                 >
                   {m.actionLabel}
                 </Button>
              )}
            </div>
          ))}
        </div>
      </BlockStack>
      </Card>
    </div>
  );

  // Confirmation modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); 
  const [conflictError, setConflictError] = useState(null);

  // Tab counts
  const counts = useMemo(() => ({
    all: sales.length,
    active: sales.filter(s => s.status === "ACTIVE").length,
    scheduled: sales.filter(s => s.status === "PENDING").length,
    expired: sales.filter(s => s.status === "COMPLETED").length,
  }), [sales]);

  const tabs = [
    { id: "all-sales", content: `All (${counts.all})`, accessibilityLabel: "All sales" },
    { id: "active-sales", content: `Active (${counts.active})`, accessibilityLabel: "Active sales" },
    { id: "scheduled-sales", content: `Scheduled (${counts.scheduled})`, accessibilityLabel: "Scheduled sales" },
    { id: "expired-sales", content: `Expired (${counts.expired})`, accessibilityLabel: "Expired sales" },
  ];

  const handleTabChange = useCallback(
    (selectedTabIndex) => setSelectedTab(selectedTabIndex),
    []
  );

  const filteredSales = sales.filter((sale) => {
    switch (selectedTab) {
      case 1: return sale.status === "ACTIVE";
      case 2: return sale.status === "PENDING";
      case 3: return sale.status === "COMPLETED";
      default: return true;
    }
  });

  const resourceName = { singular: "sale", plural: "sales" };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(filteredSales);

  // --- Confirmation helpers ---
  const requestConfirm = (type, ids, label) => {
    setConfirmAction({ type, ids, label });
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    const { type, ids } = confirmAction;

    if (type === "deactivate") {
      submit({ action: "revert", saleId: ids[0] }, { method: "post" });
    } else if (type === "delete") {
      submit({ action: "delete", saleId: ids[0] }, { method: "post" });
    } else if (type === "activate") {
      submit({ action: "activate", saleId: ids[0] }, { method: "post" });
    } else if (type === "bulkDeactivate") {
      submit({ action: "bulkDeactivate", ids: ids.join(",") }, { method: "post" });
    } else if (type === "bulkDelete") {
      submit({ action: "bulkDelete", ids: ids.join(",") }, { method: "post" });
    }

    setConfirmOpen(false);
    setConfirmAction(null);
  };

  const handleCancelConfirm = () => {
    setConfirmOpen(false);
    setConfirmAction(null);
  };

  // --- Bulk actions ---
  const promotedBulkActions = [
    {
      content: "Deactivate selected",
      onAction: () => {
        const activeIds = selectedResources.filter(id =>
          sales.find(s => s.id === id && s.status === "ACTIVE")
        );
        if (activeIds.length === 0) {
          shopify.toast.show("No active sales selected", { isError: true });
          return;
        }
        requestConfirm(
          "bulkDeactivate",
          activeIds,
          `Deactivate ${activeIds.length} active sale${activeIds.length > 1 ? "s" : ""}?`
        );
      },
    },
    {
      content: "Delete selected",
      destructive: true,
      onAction: () => {
        requestConfirm(
          "bulkDelete",
          selectedResources,
          `Delete ${selectedResources.length} sale${selectedResources.length > 1 ? "s" : ""}? This cannot be undone.`
        );
      },
    },
  ];

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  };

  const rowMarkup = filteredSales.map(
    ({ id, title, discountType, value, status, startTime, endTime, _count }, index) => (
      <IndexTable.Row
        id={id}
        key={id}
        selected={selectedResources.includes(id)}
        position={index}
      >
        <IndexTable.Cell>
          <Text fontWeight="bold" as="span">{title}</Text>
          <div style={{ fontSize: "12px", color: "#6d7175" }}>
             {discountType === "PERCENTAGE" ? `${value}% off` : `$${value} off`}
          </div>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={status === "ACTIVE" ? "success" : status === "PENDING" ? "attention" : "warning"}>
            <span className={status === "ACTIVE" ? "badge-pulse" : ""}>
              {status === "PENDING" ? "Scheduled" : status === "COMPLETED" ? "Expired" : "Active"}
            </span>
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Tooltip content={formatDate(startTime)}>
            <Text as="span" tone="subdued">{timeAgo(startTime)}</Text>
          </Tooltip>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Tooltip content={formatDate(endTime)}>
            <Text as="span" tone="subdued">{timeAgo(endTime)}</Text>
          </Tooltip>
        </IndexTable.Cell>
        <IndexTable.Cell>
           <Text as="span" alignment="end">{_count?.items || 0}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200">
            <Button size="micro" onClick={() => navigate(`/app/sales/${id}`)}>Edit</Button>
            {status === "ACTIVE" ? (
                <Button
                  size="micro"
                  tone="critical"
                  disabled={isSubmitting}
                  onClick={() => requestConfirm("deactivate", [id], `Deactivate sale "${title}"?`)}
                >
                    Deactivate
                </Button>
            ) : (
                <Button
                  size="micro"
                  variant="primary"
                  disabled={isSubmitting}
                  onClick={() => requestConfirm("activate", [id], `Activate sale "${title}"?`)}
                >
                    Activate
                </Button>
            )}
            <Button
              size="micro"
              tone="critical"
              variant="plain"
              disabled={isSubmitting}
              onClick={() => requestConfirm("delete", [id], `Delete sale "${title}"? This cannot be undone.`)}
            >
                Delete
            </Button>
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  const emptyStateMarkup = (
    <EmptyState
      heading="Create your first sale"
      action={{
        content: "Create New Sale",
        onAction: () => navigate("/app/sales/new"),
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Track and manage your sales easily.</p>
    </EmptyState>
  );

  // Confirmation message based on action type
  const confirmTitle = confirmAction?.type?.includes("Delete") || confirmAction?.type === "delete" || confirmAction?.type === "bulkDelete"
    ? "Confirm delete"
    : confirmAction?.type === "activate" ? "Confirm activate" : "Confirm deactivate";

  return (
    <Page
      title="Dashboard"
      primaryAction={sales.length > 0 ? {
        content: "Create sale",
        onAction: () => navigate("/app/sales/new"),
      } : undefined}
    >
      <Layout>
        <Layout.Section>
          {showSuccessBanner && (
             <div style={{ marginBottom: "2rem" }}>
                <Banner
                    tone="success"
                    onDismiss={dismissBanner}
                    title={`Sale activated: ${updatedCount} prices updated.`}
                >
                    <p>Prices have been successfully synced to your storefront.</p>
                </Banner>
             </div>
          )}

          {isBillingTestMode && (
             <div style={{ marginBottom: "2rem" }}>
                <Banner tone="warning" title="Test Billing Mode Active">
                    <p>The app is running with BILLING_TEST_MODE=true. Real charges will not be processed.</p>
                </Banner>
             </div>
          )}

          {cronWarning && (
             <div style={{ marginBottom: "2rem" }}>
                <Banner tone="critical" title="Cron Service Disconnected">
                    <p>The automated job scheduler hasn't run recently. Scheduled sales and expirations will not process automatically until cron is restored.</p>
                </Banner>
             </div>
          )}
          
          {!trackDismissed && (
            <div style={{ marginBottom: "2rem" }}>
              <LaunchTrack />
            </div>
          )}

          <div className="animate-fade-in-up stagger-2">
            <BlockStack gap="400">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Text as="h2" variant="headingMd">Active Campaigns</Text>
              {sales.length > 0 && (
                <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange} />
              )}
            </div>
            
            <Card padding="0">
              {sales.length === 0 ? (
                  emptyStateMarkup
              ) : (
                <IndexTable
                  resourceName={resourceName}
                  itemCount={filteredSales.length}
                  selectedItemsCount={
                    allResourcesSelected ? "All" : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  promotedBulkActions={promotedBulkActions}
                  headings={[
                    { title: "Title" },
                    { title: "Status" },
                    { title: "Start" },
                    { title: "End" },
                    { title: "Variants", alignment: "end" },
                    { title: "Actions" },
                  ]}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Card>
          </BlockStack>
          </div>
        </Layout.Section>
      </Layout>

      {/* Confirmation Modal */}
      <Modal
        open={confirmOpen}
        onClose={handleCancelConfirm}
        title={confirmTitle}
        primaryAction={{
          content: confirmAction?.type?.includes("elete") ? "Delete" : confirmAction?.type === "activate" ? "Activate" : "Deactivate",
          destructive: !confirmAction?.type?.includes("activate"), // Not destructive for activate
          loading: isSubmitting,
          onAction: handleConfirm,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: handleCancelConfirm, disabled: isSubmitting },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">{confirmAction?.label}</Text>
            {isSubmitting && (
              <InlineStack gap="200" align="center">
                <Spinner size="small" />
                <Text as="span" tone="subdued">Processing…</Text>
              </InlineStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Conflict Error Modal */}
      <Modal
        open={!!conflictError}
        onClose={() => setConflictError(null)}
        title="Scheduling Conflict"
        primaryAction={{
          content: "Understood",
          onAction: () => setConflictError(null),
        }}
      >
        <Modal.Section>
          <Banner tone="warning">
            <p>{conflictError}</p>
          </Banner>
        </Modal.Section>
      </Modal>
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
