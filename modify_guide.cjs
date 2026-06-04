const fs = require('fs');
let file = fs.readFileSync('app/routes/app._index.jsx', 'utf8');

// 1. Remove Quick Actions
const quickActionsRegex = /<div style=\{\{ marginBottom: "2rem" \}\}>\s*<Card>\s*<BlockStack gap="400">\s*<Text as="h2" variant="headingMd" fontWeight="bold">Quick Actions<\/Text>\s*<InlineStack gap="300">\s*<Button variant="primary" onClick=\{.*?\}\s*>Create Sale<\/Button>\s*<Button onClick=\{.*?\}\s*>Create Timer<\/Button>\s*<Button onClick=\{.*?\}\s*>Create Offer<\/Button>\s*<\/InlineStack>\s*<\/BlockStack>\s*<\/Card>\s*<\/div>/m;
if (file.match(quickActionsRegex)) {
   file = file.replace(quickActionsRegex, '');
} else {
   console.log("Could not find Quick Actions");
}

// 2. Refactor SetupGuide to allow buttons inside steps
const mapRegex = /\]\.map\(\(\{ step, title, body \}\) => \(\s*<div key=\{step\}.*?>\s*<div.*?>\{step\}<\/div>\s*<BlockStack gap="100">\s*<Text as="span".*?>\{title\}<\/Text>\s*<Text as="p".*?>\{body\}<\/Text>\s*<\/BlockStack>\s*<\/div>\s*\)\)/g;

file = file.replace(mapRegex, `].map(({ step, title, body, action }) => (
                          <div key={step} style={{ display: "flex", gap: "16px" }}>
                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#1a1a1a", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>{step}</div>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">{body}</Text>
                              {action && (
                                 <Box paddingBlockStart="100">
                                   <Button {...action.props}>{action.label}</Button>
                                 </Box>
                              )}
                            </BlockStack>
                          </div>
                        ))`);

// 3. Update Sales Tab steps
const salesStepsRegex = /\{\s*step: "1", title: "Add the Sale Block to Your Theme", body: 'Go to your Shopify Admin → Online Store → Themes → Customize\. On the product page template, click Add Block and add the Loom Sale block\. Save\.' \},\s*\{\s*step: "2", title: "Create a Sale", body: 'Go to Sales → Create Sale\. Give it a title, choose a discount type \(% or fixed amount\), and set your start and end times\.' \},/m;

const salesStepsReplacement = `{ step: "1", title: "Add the Sale Block to Your Theme", body: 'Go to your Shopify Admin → Online Store → Themes → Customize. On the product page template, click Add Block and add the Loom Sale block. Save.', action: { label: "Open Theme Editor", props: { url: "https://admin.shopify.com/themes/current/editor", external: true, target: "_top", variant: "primary" } } },
                          { step: "2", title: "Create a Sale", body: 'Go to Sales → Create Sale. Give it a title, choose a discount type (% or fixed amount), and set your start and end times.', action: { label: "Create Sale", props: { onClick: () => navigate("/app/sales/new"), variant: "primary" } } },`;

if (file.match(salesStepsRegex)) {
    file = file.replace(salesStepsRegex, salesStepsReplacement);
}

// 4. Remove Sales Tab bottom buttons
const salesBottomButtonsRegex = /<InlineStack gap="200">\s*<Button variant="primary" onClick=\{.*?\}\s*>Create your first sale<\/Button>\s*<Button variant="plain" url="\/app\/help">Learn more<\/Button>\s*<\/InlineStack>/m;
if (file.match(salesBottomButtonsRegex)) {
    file = file.replace(salesBottomButtonsRegex, '<Button variant="plain" url="/app/help">Learn more</Button>');
}


// 5. Update Timers Tab steps
const timersStepsRegex = /\{\s*step: "1", title: "Add the Timer Block to Your Theme", body: 'Go to your Shopify Admin → Online Store → Themes → Customize\. On the product page template, click Add Block and add the Loom Timer block\. Save\.' \},\s*\{\s*step: "2", title: "Create a Timer", body: 'Go to Timers → Create Timer\. Set a display name and optionally link it to a Sale so the countdown matches your sale end time\.' \},/m;

const timersStepsReplacement = `{ step: "1", title: "Add the Timer Block to Your Theme", body: 'Go to your Shopify Admin → Online Store → Themes → Customize. On the product page template, click Add Block and add the Loom Timer block. Save.', action: { label: "Open Theme Editor", props: { url: "https://admin.shopify.com/themes/current/editor", external: true, target: "_top", variant: "primary" } } },
                          { step: "2", title: "Create a Timer", body: 'Go to Timers → Create Timer. Set a display name and optionally link it to a Sale so the countdown matches your sale end time.', action: { label: "Create Timer", props: { onClick: () => navigate("/app/timers/new"), variant: "primary" } } },`;

if (file.match(timersStepsRegex)) {
    file = file.replace(timersStepsRegex, timersStepsReplacement);
}

// 6. Remove Timers Tab bottom buttons
const timersBottomButtonsRegex = /<InlineStack gap="200">\s*<Button variant="primary" onClick=\{.*?\}>Create a timer<\/Button>\s*<Button variant="plain" url="https:\/\/admin\.shopify\.com\/themes\/current\/editor" external target="_top">Open Theme Editor<\/Button>\s*<\/InlineStack>/m;
if (file.match(timersBottomButtonsRegex)) {
    file = file.replace(timersBottomButtonsRegex, '');
}

// 7. Update Offers Tab steps
const offersStepsRegex = /\{\s*step: "1", title: "Create a Discount in Shopify Admin", body: 'Go to your Shopify Admin → Discounts → Create discount\. Set up your discount \(percentage, fixed, BOGO, etc\.\) and copy the discount code\.' \},\s*\{\s*step: "2", title: "Add the Offer Block to Your Theme", body: 'Go to your Shopify Admin → Online Store → Themes → Customize\. On the product page template, add the Loom Offer block and save\.' \},\s*\{\s*step: "3", title: "Create an Offer in Loom", body: 'Go to Offers → Create Offer\. Enter the Shopify discount code you created in step 1, set a title, schedule, and choose which products to display it on\.' \},/m;

const offersStepsReplacement = `{ step: "1", title: "Create a Discount in Shopify Admin", body: 'Go to your Shopify Admin → Discounts → Create discount. Set up your discount (percentage, fixed, BOGO, etc.) and copy the discount code.', action: { label: "Shopify Discounts", props: { url: "https://admin.shopify.com/discounts", external: true, target: "_top", variant: "primary" } } },
                          { step: "2", title: "Add the Offer Block to Your Theme", body: 'Go to your Shopify Admin → Online Store → Themes → Customize. On the product page template, add the Loom Offer block and save.', action: { label: "Open Theme Editor", props: { url: "https://admin.shopify.com/themes/current/editor", external: true, target: "_top", variant: "primary" } } },
                          { step: "3", title: "Create an Offer in Loom", body: 'Go to Offers → Create Offer. Enter the Shopify discount code you created in step 1, set a title, schedule, and choose which products to display it on.', action: { label: "Create Offer", props: { onClick: () => navigate("/app/coupons/new"), variant: "primary" } } },`;

if (file.match(offersStepsRegex)) {
    file = file.replace(offersStepsRegex, offersStepsReplacement);
}

// 8. Remove Offers Tab bottom buttons
const offersBottomButtonsRegex = /<InlineStack gap="200">\s*<Button variant="primary" onClick=\{.*?\}>Create an offer<\/Button>\s*<Button variant="plain" url="https:\/\/admin\.shopify\.com\/discounts" external target="_top">Shopify Discounts<\/Button>\s*<\/InlineStack>/m;
if (file.match(offersBottomButtonsRegex)) {
    file = file.replace(offersBottomButtonsRegex, '');
}


fs.writeFileSync('app/routes/app._index.jsx', file);
console.log("Updated home page dashboard");
