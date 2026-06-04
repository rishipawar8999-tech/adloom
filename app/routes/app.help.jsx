import { Page, Layout, Card, Text, BlockStack, Collapsible, Button, Divider, InlineStack, Icon, Box } from "@shopify/polaris";
import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, ChatIcon, EmailIcon } from "@shopify/polaris-icons";

// Data Structure for Help Topics
const helpTopics = [
  {
    category: "Quick Start Guides",
    items: [
      {
        q: "🛍 Sales – How to Create & Manage Discounts",
        a: (
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="bold">How do I create a Sale?</Text>
            <Box paddingInlineStart="400">
              <Text as="p" variant="bodyMd">1. Go to <Text as="span" fontWeight="bold">Sales</Text> → <Text as="span" fontWeight="bold">Create New Sale</Text></Text>
              <Text as="p" variant="bodyMd">2. Select products or collections</Text>
              <Text as="p" variant="bodyMd">3. Set discount percentage or fixed amount</Text>
              <Text as="p" variant="bodyMd">4. Choose start & end date</Text>
              <Text as="p" variant="bodyMd">5. Save & Activate</Text>
            </Box>
            <Divider />
            <Text as="p" variant="bodyMd" fontWeight="bold">How do exclusions work?</Text>
            <Text as="p" variant="bodyMd">You can exclude specific products or collections from a Sale. This prevents overlapping discounts and keeps margins protected.</Text>
            <Divider />
            <Text as="p" variant="bodyMd" fontWeight="bold">Can I schedule future sales?</Text>
            <Text as="p" variant="bodyMd">Yes. Just set a future start date — Loom activates it automatically.</Text>
          </BlockStack>
        )
      },
      {
        q: "⏳ Timers – Shopify 2.0 vs Legacy Themes",
        a: (
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="bold">Shopify 2.0 Themes (Recommended)</Text>
            <Box paddingInlineStart="400">
              <Text as="p" variant="bodyMd">1. Go to <Text as="span" fontWeight="bold">Online Store</Text> → <Text as="span" fontWeight="bold">Customize</Text></Text>
              <Text as="p" variant="bodyMd">2. Add App Block</Text>
              <Text as="p" variant="bodyMd">3. Select <Text as="span" fontWeight="bold">Loom Timer</Text></Text>
              <Text as="p" variant="bodyMd">4. Position it where needed and Save</Text>
            </Box>
            <Divider />
            <Text as="p" variant="bodyMd" fontWeight="bold">Legacy Themes (Manual Install)</Text>
            <Text as="p" variant="bodyMd">Copy the provided embed snippet, paste it into your product template, and save changes.</Text>
            <Text as="p" variant="bodyMd" tone="subdued">Need assistance? Email us at <Text as="span" fontWeight="bold">Hello@adloomx.com</Text>.</Text>
          </BlockStack>
        )
      },
      {
        q: "🎟 Coupons – Creating & Displaying Coupons",
        a: (
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="bold">How to create a Coupon?</Text>
            <Box paddingInlineStart="400">
              <Text as="p" variant="bodyMd">1. Go to <Text as="span" fontWeight="bold">Offers</Text> → <Text as="span" fontWeight="bold">Create Coupon</Text></Text>
              <Text as="p" variant="bodyMd">2. Enter code and discount value</Text>
              <Text as="p" variant="bodyMd">3. Choose eligible products and validity period</Text>
              <Text as="p" variant="bodyMd">4. Save</Text>
            </Box>
            <Text as="p" variant="bodyMd" fontWeight="bold">How to display coupons?</Text>
            <Text as="p" variant="bodyMd">Use the App Block (2.0 themes) or manual embed (legacy) to show them on product pages.</Text>
          </BlockStack>
        )
      }
    ]
  },
  {
    category: "Billing & Plans",
    items: [
      {
        q: "Can I change plans anytime?",
        a: "Yes. Upgrades apply immediately. Downgrades apply at the end of billing cycle."
      },
      {
        q: "Is there a free trial?",
        a: "Yes. All paid plans include a 3-day trial period."
      }
    ]
  }
];

function FaqItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid var(--p-color-border-subdued)" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ cursor: "pointer", padding: "16px 0" }}
      >
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="bodyMd" fontWeight="semibold">
            {question}
          </Text>
          <Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
        </InlineStack>
      </div>
      <Collapsible open={open} id={`faq-${question}`}>
        <div style={{ paddingBottom: "16px", paddingLeft: "8px" }}>
           {typeof answer === 'string' ? (
                <Text as="p" variant="bodyMd" tone="subdued">{answer}</Text>
           ) : (
               <div style={{ color: "var(--p-color-text-subdued)" }}>{answer}</div>
           )}
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
          <BlockStack gap="600">
            {helpTopics.map((topic, i) => (
              <Card key={i}>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">{topic.category}</Text>
                  <BlockStack gap="0">
                    {topic.items.map((item, j) => (
                      <FaqItem key={j} question={item.q} answer={item.a} />
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            ))}

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Contact Support</Text>
                <Text as="p" variant="bodyMd">
                  Need help? We reply within 24 hours.
                </Text>
                <InlineStack gap="300">
                  <Button url="mailto:Hello@adloomx.com" icon={EmailIcon} variant="primary" target="_top">
                    Contact Support
                  </Button>
                  <Button 
                    url="mailto:Hello@adloomx.com?subject=Loom%20Feedback" 
                    icon={ChatIcon} 
                    variant="plain"
                    target="_top"
                  >
                    Send Feedback
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

             <Box paddingBlock="400">
                 <BlockStack gap="200" align="center">
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Loom is built to increase conversions through urgency and smart discounting.
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        If you need strategy advice, email us — we’ll help you structure your offers.
                    </Text>
                 </BlockStack>
             </Box>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
