import { useState, useEffect } from "react";
import { Modal, Text } from "@shopify/polaris";
import { useActionData, useNavigate } from "@remix-run/react";

export function ActionErrorModal() {
  const actionData = useActionData();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // Show modal if there are errors AND one of the errors is a 'base' error
    // (We don't want to popup for simple field validation errors like 'Title required', those are inline)
    if (actionData?.errors && actionData.errors.base) {
      setShowModal(true);
    }
  }, [actionData]);

  if (!actionData?.errors?.base) return null;

  const errorText = actionData.errors.base;
  const isLimitError = errorText.toLowerCase().includes("limit") || errorText.toLowerCase().includes("upgrade");

  return (
    <Modal
      open={showModal}
      onClose={() => setShowModal(false)}
      title={isLimitError ? "Plan Limit Reached" : "Submission Error"}
      primaryAction={isLimitError ? {
        content: "Upgrade Plan",
        onAction: () => navigate(`/app/pricing${window.location.search}`),
      } : {
        content: "Okay",
        onAction: () => setShowModal(false),
      }}
      secondaryActions={isLimitError ? [{
        content: "Cancel",
        onAction: () => setShowModal(false),
      }] : []}
    >
      <Modal.Section>
        <Text as="p">{errorText}</Text>
      </Modal.Section>
    </Modal>
  );
}
