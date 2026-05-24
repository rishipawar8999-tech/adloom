import { Page, Layout, Card, Text, BlockStack, Collapsible, Button, Divider, InlineStack, Icon } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";

const faqs = [
  {
    q: "How does Loom - Offer & Sales work?",
    a: "Loom edits your product prices in bulk. When you activate a sale, it sets the discounted price as the current price and stores the original price as the compare-at price. Your theme then automatically shows the crossed-out price and sale badge — no theme changes needed.",
  },
  {
    q: "What happens when the sale ends?",
    a: "When you deactivate a sale (manually or via scheduled end date), Loom restores the original prices. You can choose between restoring exact previous prices or replacing the current price with the compare-at price.",
  },
  {
    q: "Will this work with my theme?",
    a: "Yes! Loom works with all Shopify themes. Since it modifies actual product prices and compare-at prices, any theme that supports sale badges and crossed-out prices will display correctly. No theme code changes are required.",
  },
  {
    q: "Can I run multiple sales at the same time?",
    a: "Yes, you can have multiple active sales. By default, Loom skips products that are already discounted by another sale. You can override this behavior in the sale settings by checking 'Allow this sale to override other Loom discounts'.",
  },
  {
    q: "What if I add new products while a sale is active?",
    a: "New products won't be included automatically. Click the 'Reactivate' button on the sale to resync — Loom will check your sale criteria and include any new matching products.",
  },
  {
    q: "Does Loom affect my discount codes?",
    a: "Loom changes actual product prices, which means discount codes will apply on top of the sale price. Currently, Shopify doesn't have a native way to prevent combining discount codes with already-reduced prices.",
  },
  {
    q: "Is there a limit on the number of products I can put on sale?",
    a: "Yes, limits depend on your plan. The Free plan supports up to 50 variants, Starter up to 2,000, Plus up to 20,000, and Professional offers unlimited variants.",
  },
  {
    q: "What happens if another app or system changes my prices?",
    a: "If another app or inventory system updates prices while a sale is active, it may override Loom's changes. We recommend temporarily pausing other price-editing tools during an active sale.",
  },
];

function FaqItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid var(--p-color-border-subdued)" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ cursor: "pointer", padding: "12px 0" }}
      >
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="bodyMd" fontWeight="semibold">
            {question}
          </Text>
          <Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
        </InlineStack>
      </div>
      <Collapsible open={open} id={`faq-${question}`}>
        <div style={{ paddingBottom: "12px" }}>
          <Text as="p" variant="bodyMd" tone="subdued">
            {answer}
          </Text>
        </div>
      </Collapsible>
    </div>
  );
}

export default function HelpPage() {
  return (
    <Page title="Help and Support" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Frequently Asked Questions</Text>
                {faqs.map((faq, i) => (
                  <FaqItem key={i} question={faq.q} answer={faq.a} />
                ))}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Contact us</Text>
                <Text as="p" variant="bodyMd">
                  Can't find what you're looking for? We're happy to help.
                </Text>
                <InlineStack gap="300">
                  <Button url="mailto:Hello@adloomx.com">Email support</Button>
                  <Button variant="plain">View documentation</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Feature requests</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Have an idea for a feature that would make Loom better? We'd love to hear it.
                </Text>
                <div>
                  <Button variant="plain">Submit a feature request</Button>
                </div>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
