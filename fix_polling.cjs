const fs = require('fs');
let file = fs.readFileSync('app/routes/app._index.jsx', 'utf8');

const regex = /const isProcessing = sales\.some\(s => s\.status === "PENDING" && s\.totalItems > 0 && s\.processedItems < s\.totalItems\);/m;
const replacement = `const isProcessing = sales.some(s => s.status === "PENDING" && new Date(s.startTime) <= new Date());`;

if (file.match(regex)) {
   file = file.replace(regex, replacement);
   fs.writeFileSync('app/routes/app._index.jsx', file);
   console.log("Fixed polling condition");
} else {
   console.log("Regex not found in app._index.jsx");
}

const badgeRegex = /\{status === "PENDING" && totalItems > 0 && processedItems < totalItems \? \(/m;
const badgeReplacement = `{status === "PENDING" && new Date(startTime) <= new Date() ? (`;

if (file.match(badgeRegex)) {
   file = file.replace(badgeRegex, badgeReplacement);
   fs.writeFileSync('app/routes/app._index.jsx', file);
   console.log("Fixed badge condition");
} else {
    console.log("Badge Regex not found in app._index.jsx");
}

