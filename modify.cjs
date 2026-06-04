const fs = require('fs');
let file = fs.readFileSync('app/routes/app._index.jsx', 'utf8');

// 1. Setup guide 4 steps to 5 steps
file = file.replace(
  /{ step: "1", title: "Create a Sale"/g,
  '{ step: "1", title: "Add the Sale Block to Your Theme", body: \'Go to your Shopify Admin → Online Store → Themes → Customize. On the product page template, click Add Block and add the Loom Sale block. Save.\' },\n                          { step: "2", title: "Create a Sale"'
);
file = file.replace(/{ step: "2", title: "Choose What to Discount"/g, '{ step: "3", title: "Choose What to Discount"');
file = file.replace(/{ step: "3", title: "Set Advanced Options \\(Optional\\)"/g, '{ step: "4", title: "Set Advanced Options (Optional)"');
file = file.replace(/{ step: "4", title: "Activate"/g, '{ step: "5", title: "Activate"');

// 2. Remove LaunchTrack definition completely using a regex
file = file.replace(/const LaunchTrack = \(\) => \([\s\S]*?\);\s*\/\/\s*Confirmation modal state/m, '// Confirmation modal state');

// 3. Replace the rendering block
const renderRegex = /<SetupGuide \/>\s*\{\!trackDismissed && \([\s\S]*?LaunchTrack \/>\s*<\/div>\s*\)\}\s*<div className="animate-fade-in-up stagger-2">/m;

const newRender = `{showReinstallBanner && (
            <div style={{ marginBottom: "2rem" }}>
              <Banner
                title="Welcome back! Your account is on the Free plan"
                tone="warning"
                action={{ content: "Choose a plan", onAction: () => navigate(\`/app/pricing\${window.location.search}\`) }}
                onDismiss={() => setShowReinstallBanner(false)}
              >
                <p>
                  You previously had a paid subscription. Please select a plan to restore your limits.
                  Note: Shopify does not offer a new free trial if you have used one before.
                </p>
              </Banner>
            </div>
          )}

          <div style={{ marginBottom: "2rem" }}>
            <Banner tone="info">
               <p>Enjoying Loom? We'd love it if you could <a href="https://apps.shopify.com/adloom-offer-sales#reviews" target="_blank" rel="noopener noreferrer">leave us a review</a> on the Shopify App Store. Your feedback helps us build better tools for you!</p>
            </Banner>
          </div>

          <div style={{ marginBottom: "2rem" }}>
             <Card>
                <BlockStack gap="400">
                   <Text as="h2" variant="headingMd" fontWeight="bold">Quick Actions</Text>
                   <InlineStack gap="300">
                      <Button variant="primary" onClick={() => navigate("/app/sales/new")}>Create Sale</Button>
                      <Button onClick={() => navigate("/app/timers/new")}>Create Timer</Button>
                      <Button onClick={() => navigate("/app/coupons/new")}>Create Offer</Button>
                   </InlineStack>
                </BlockStack>
             </Card>
          </div>

          <SetupGuide />

          <div className="animate-fade-in-up stagger-2">`;

file = file.replace(renderRegex, newRender);

fs.writeFileSync('app/routes/app._index.jsx', file);
console.log('Done!');
