import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { Page, Layout, Card, Text, Button, BlockStack, Banner } from "@shopify/polaris";
import { useSubmit, useNavigation } from "@remix-run/react";

export async function loader({ request }) {
  const { billing } = await authenticate.admin(request);
  const isTest = process.env.NODE_ENV !== "production" || process.env.SHOPIFY_IS_TEST_CHARGE === "true";
  const subscription = await billing.require({
    plans: ["Basic", "Growth", "Pro", "Basic Annual", "Growth Annual", "Pro Annual"],
    isTest: isTest,
    onFailure: async () => null,
  });

  if (!subscription) {
    return redirect("/app/pricing");
  }

  return json({ subscription });
}

export async function action({ request }) {
  const { billing } = await authenticate.admin(request);
  const isTest = process.env.NODE_ENV !== "production" || process.env.SHOPIFY_IS_TEST_CHARGE === "true";
  const subscription = await billing.require({
    plans: ["Basic", "Growth", "Pro", "Basic Annual", "Growth Annual", "Pro Annual"],
    isTest: isTest,
    onFailure: async () => null,
  });

  if (subscription) {
    await billing.cancel({
      subscriptionId: subscription.id,
      isTest: isTest,
      prorate: true,
    });
  }

  return redirect("/app/pricing?cancelled=true");
}

export default function Cancel() {
  const submit = useSubmit();
  const nav = useNavigation();
  const isLoading = nav.state === "submitting";

  return (
    <Page title="Cancel Subscription" backAction={{ url: "/app/pricing" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Are you sure you want to cancel?</Text>
              <Text as="p">
                By cancelling your subscription, you will be moved to the **Free plan** at the end of your current billing period.
              </Text>
              <Banner tone="warning">
                <p>
                  Any active sales, coupons, or timers exceeding the Free plan limits (1 Sale, 2 Coupons, 1 Timer) will remain active until manually deactivated or deleted, but you won't be able to create new ones until you are within your limits.
                </p>
              </Banner>
              <InlineStack align="end" gap="300">
                <Button onClick={() => window.history.back()}>Back</Button>
                <Button variant="primary" destructive loading={isLoading} onClick={() => submit({}, { method: "post" })}>
                  Confirm Cancellation
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
