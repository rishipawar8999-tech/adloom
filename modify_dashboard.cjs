const fs = require('fs');
let file = fs.readFileSync('app/routes/app._index.jsx', 'utf8');

// Add useFetcher
const importRegex = /useLoaderData, useActionData, useNavigation, useSubmit, useNavigate, useSearchParams, useRouteError, isRouteErrorResponse/m;
file = file.replace(importRegex, 'useLoaderData, useActionData, useNavigation, useSubmit, useNavigate, useSearchParams, useRouteError, isRouteErrorResponse, useRevalidator');

const loaderDataRegex = /const \{ allowed, productCount \} = useLoaderData\(\);/m;
// Wait, app._index.jsx doesn't have allowed, productCount. It has:
// const { sales, timers, coupons, usage, isReinstall, cronLastRun, isBillingTestMode } = useLoaderData();

const initRegex = /const \{ sales, timers, coupons, usage, isReinstall, cronLastRun, isBillingTestMode \} = useLoaderData\(\);/m;
const initReplacement = `const { sales, timers, coupons, usage, isReinstall, cronLastRun, isBillingTestMode } = useLoaderData();
  const revalidator = useRevalidator();

  // Poll if any sale is currently processing
  useEffect(() => {
    const isProcessing = sales.some(s => s.status === "PENDING" && s.totalItems > 0 && s.processedItems < s.totalItems);
    if (isProcessing) {
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [sales, revalidator]);`;

if (file.match(initRegex)) {
   file = file.replace(initRegex, initReplacement);
   console.log("Added polling hook");
}

// Modify the Badge cell in rowMarkup
const badgeRegex = /<Badge tone=\{status === "ACTIVE" \? "success" : status === "PENDING" \? "attention" : "warning"\}>[\s\S]*?<\/Badge>/m;
const badgeReplacement = `{status === "PENDING" && totalItems > 0 && processedItems < totalItems ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '120px' }}>
               <Badge tone="attention">Processing</Badge>
               <div style={{ width: '100%', backgroundColor: '#dfe3e8', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                  <div style={{ width: \`\${(processedItems / totalItems) * 100}%\`, backgroundColor: '#008060', height: '100%', transition: 'width 0.3s ease' }}></div>
               </div>
               <div style={{ fontSize: '10px', color: '#6d7175', textAlign: 'center' }}>
                  {processedItems} / {totalItems}
               </div>
            </div>
          ) : (
            <Badge tone={status === "ACTIVE" ? "success" : status === "PENDING" ? "attention" : "warning"}>
              <span className={status === "ACTIVE" ? "badge-pulse" : ""}>
                {status === "PENDING" ? "Scheduled" : status === "COMPLETED" ? "Expired" : "Active"}
              </span>
            </Badge>
          )}`;

file = file.replace(badgeRegex, badgeReplacement);

// Wait, the row arguments need to include processedItems and totalItems
const rowMarkupRegex = /const rowMarkup = filteredSales\.map\(\s*\(\{\s*id, title, discountType, value, status, startTime, endTime, _count\s*\}, index\) => \(/m;
const rowMarkupReplacement = `const rowMarkup = filteredSales.map(
    ({ id, title, discountType, value, status, startTime, endTime, _count, processedItems, totalItems }, index) => (`;
file = file.replace(rowMarkupRegex, rowMarkupReplacement);

fs.writeFileSync('app/routes/app._index.jsx', file);
console.log("Done");
