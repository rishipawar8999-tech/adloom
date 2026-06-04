import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useSearchParams } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getTimers, deleteTimer } from "../models/timer.server";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Button,
  Text,
  EmptyState,
  InlineStack,
  Modal,
  BlockStack,
  Tooltip,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

// Relative time helper
function timeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const absDiff = Math.abs(diffMs);
  const mins = Math.floor(absDiff / 60000);
  const hours = Math.floor(absDiff / 3600000);
  const days = Math.floor(absDiff / 86400000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const timers = await getTimers(session.shop);
  return json({ timers });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const id = formData.get("id");
  
  if (formData.get("action") === "delete") {
     await deleteTimer(id, session.shop);
  }
  
  return json({ success: true });
}

export default function TimersPage() {
  const { timers } = useLoaderData();
  const navigate = useNavigate();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();

  // Delete confirmation modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [timerToDelete, setTimerToDelete] = useState(null);

  // Success toast on redirect
  useEffect(() => {
    if (searchParams.get("success") === "true") {
      shopify.toast.show("Your timer has been saved.");
    }
    if (searchParams.get("deleted") === "true") {
      shopify.toast.show("Your timer has been deleted.");
    }
  }, [searchParams, shopify]);

  const confirmDelete = useCallback((timer) => {
    setTimerToDelete(timer);
    setDeleteModalOpen(true);
  }, []);

  const handleDelete = useCallback(() => {
    if (timerToDelete) {
      submit({ action: "delete", id: timerToDelete.id }, { method: "post" });
      shopify.toast.show(`"${timerToDelete.name}" has been deleted.`);
    }
    setDeleteModalOpen(false);
    setTimerToDelete(null);
  }, [timerToDelete, submit, shopify]);

  const cancelDelete = useCallback(() => {
    setDeleteModalOpen(false);
    setTimerToDelete(null);
  }, []);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  };

  const rowMarkup = timers.map(
    ({ id, name, position, textTemplate, updatedAt }, index) => (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell>
          <Text fontWeight="bold" as="span">{name}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{position}</IndexTable.Cell>
        <IndexTable.Cell>
           <Text tone="subdued">{textTemplate || "—"}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Tooltip content={formatDate(updatedAt)}>
            <Text as="span" tone="subdued">{timeAgo(updatedAt)}</Text>
          </Tooltip>
        </IndexTable.Cell>
        <IndexTable.Cell>
           <InlineStack gap="200">
             <Button size="micro" onClick={() => navigate(`/app/timers/${id}`)}>Edit</Button>
             <Button
               size="micro"
               tone="critical"
               onClick={() => confirmDelete({ id, name })}
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
      heading="Create your first countdown timer"
      action={{
        content: "Create Timer",
        onAction: () => navigate("/app/timers/new"),
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Drive urgency and increase conversions with countdown timers.</p>
    </EmptyState>
  );

  return (
    <Page
      title="Timers"
      primaryAction={{
        content: "Create Timer",
        onAction: () => navigate("/app/timers/new"),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {timers.length === 0 ? (
              emptyStateMarkup
            ) : (
              <IndexTable
                resourceName={{ singular: "timer", plural: "timers" }}
                itemCount={timers.length}
                headings={[
                  { title: "Name" },
                  { title: "Position" },
                  { title: "Template" },
                  { title: "Last edited" },
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

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={cancelDelete}
        title="Delete timer"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: cancelDelete },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              Are you sure you want to delete "{timerToDelete?.name}"? This cannot be undone.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
