import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useSearchParams, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getCoupons, getCoupon, deleteCoupon } from "../models/coupon.server";
import { useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Button,
  Text,
  EmptyState,
  Badge,
  InlineStack,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const coupons = await getCoupons(session.shop);
  return json({ coupons });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const id = formData.get("id");

  if (formData.get("action") === "delete") {
    const coupon = await getCoupon(id, session.shop);
    if (!coupon) throw new Response("Unauthorized", { status: 403 });
    await deleteCoupon(id);
  }

  return json({ success: true, action: "deleted" });
}

export default function CouponsPage() {
  const { coupons } = useLoaderData();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const actionData = useActionData();
  const shopify = useAppBridge();

  useEffect(() => {
    if (searchParams.get("success") === "true") {
      shopify.toast.show(searchParams.get("action") === "created" ? "Your offer has been created successfully!" : "Your offer has been updated successfully!");
      setSearchParams({}, { replace: true });
    } else if (actionData?.success && actionData?.action === "deleted") {
      shopify.toast.show("Your offer has been deleted.");
    }
  }, [searchParams, setSearchParams, actionData, shopify]);

  const statusBadge = (coupon) => {
    const now = new Date();
    const start = new Date(coupon.startTime);
    const end = new Date(coupon.endTime);
    if (now < start) return <Badge tone="attention">Scheduled</Badge>;
    if (now > end) return <Badge tone="warning">Expired</Badge>;
    return <Badge tone="success">Active</Badge>;
  };

  const formatDate = (d) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const rowMarkup = coupons.map((coupon, index) => (
    <IndexTable.Row id={coupon.id} key={coupon.id} position={index}>
      <IndexTable.Cell>
        <Text fontWeight="bold" as="span">
          {coupon.offerTitle}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="info">{coupon.couponCode}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(coupon)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text tone="subdued">
          {formatDate(coupon.startTime)} – {formatDate(coupon.endTime)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text tone="subdued">
          {(() => {
             try {
                const style = JSON.parse(coupon.style || "{}");
                const selection = style.selection || {};
                switch (selection.type) {
                  case "collections":
                    return `${selection.collections?.length || 0} collections`;
                  case "tags":
                    return `${selection.tags?.length || 0} tags`;
                  case "vendors":
                    return `${selection.vendors?.length || 0} vendors`;
                  case "all":
                    return "Entire store";
                  case "products":
                  default:
                    return `${coupon.products?.length || 0} products`;
                }
             } catch {
                return `${coupon.products?.length || 0} products`;
             }
          })()}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Button size="micro" url={`/app/coupons/${coupon.id}`}>
            Edit
          </Button>
          <Button
            size="micro"
            tone="critical"
            onClick={() =>
              submit(
                { action: "delete", id: coupon.id },
                { method: "post" }
              )
            }
          >
            Delete
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const emptyStateMarkup = (
    <EmptyState
      heading="Create your first offer"
      action={{
        content: "Create Offer",
        url: "/app/coupons/new",
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>
        Create offers and display them on your product pages.
      </p>
    </EmptyState>
  );

  return (
    <Page
      title="Offers"
      primaryAction={{
        content: "Create Offer",
        url: "/app/coupons/new",
      }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {coupons.length === 0 ? (
              emptyStateMarkup
            ) : (
              <IndexTable
                resourceName={{ singular: "offer", plural: "offers" }}
                itemCount={coupons.length}
                headings={[
                  { title: "Offer" },
                  { title: "Code" },
                  { title: "Status" },
                  { title: "Schedule" },
                  { title: "Products" },
                  { title: "Actions" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
