import { json, redirect } from "@remix-run/node";
import { useNavigation, useSubmit, useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { checkLimit, checkDesignLimit } from "../models/billing.server";
import { createTimer } from "../models/timer.server";
import { TimerForm } from "../components/TimerForm";
import { DirtyStateModal } from "../components/DirtyStateModal";
import { ActionErrorModal } from "../components/ActionErrorModal";
import { useState } from "react";
import { Page, Layout, Banner, Button } from "@shopify/polaris";

export async function loader({ request }) {
  await authenticate.admin(request);
  const allowed = await checkLimit(request, "timers");
  const designAllowed = await checkDesignLimit(request);
  return json({ allowed, designAllowed });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const allowed = await checkLimit(request, "timers");
  if (!allowed) {
      return json({ errors: { base: "Limit reached" } }, { status: 403 });
  }
  const formData = await request.json(); 
  
  // Check Design Limit
  const style = JSON.parse(formData.style || "{}");
  const presetId = style.presetId;
  const isPremiumPreset = ["urgent", "midnight", "custom"].includes(presetId);
  
  if (isPremiumPreset) {
      const designAllowed = await checkDesignLimit(request);
      if (!designAllowed) {
          return json({ errors: { base: "Custom designs and premium presets are only available on the Growth plan. Please upgrade to use this design." } }, { status: 403 });
      }
  }

  await createTimer(formData, session.shop);
  return redirect("/app/timers?success=true&action=created");
}

export default function NewTimerPage() {
  const submit = useSubmit();
  const nav = useNavigation();
  const { allowed, designAllowed } = useLoaderData();
  const isLoading = nav.state === "submitting";

  const [isDirty, setIsDirty] = useState(false);

  const handleSave = (data) => {
    submit(data, { method: "post", encType: "application/json" });
  };

  return (
    <Page title="Create timer" backAction={{ url: "/app/timers" }}>
      {!allowed && (
        <Layout>
          <Layout.Section>
            <Banner tone="warning" title="Limit Reached">
              <p>You have reached the limit of active timers for your current plan. <Button variant="plain" onClick={() => navigate(`/app/pricing${window.location.search}`)}>Upgrade now</Button> to create more.</p>
            </Banner>
          </Layout.Section>
        </Layout>
      )}
      <DirtyStateModal isDirty={isDirty} />
      <ActionErrorModal />
      <TimerForm onSave={handleSave} isLoading={isLoading} disabled={!allowed} onDirty={() => setIsDirty(true)} designAllowed={designAllowed} />
    </Page>
  );
}
