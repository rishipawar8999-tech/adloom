const fs = require('fs');
let file = fs.readFileSync('app/routes/app.sales.new.jsx', 'utf8');

const regex = /if \(start <= now\) \{\s*updatedCount = await applySale\(sale\.id, admin\);\s*\}/m;
const replacement = `if (start <= now) {
    // Fire and forget so we don't timeout, frontend can poll progress
    applySale(sale.id, admin).catch(err => console.error("Async applySale failed:", err));
  }`;

if (file.match(regex)) {
   file = file.replace(regex, replacement);
   fs.writeFileSync('app/routes/app.sales.new.jsx', file);
   console.log("Replaced in app.sales.new.jsx");
} else {
   console.log("Could not find regex in app.sales.new.jsx");
}

let file2 = fs.readFileSync('app/routes/app.sales.$id.jsx', 'utf8');
const regex2 = /if \(start <= now\) \{\s*updatedCount = await applySale\(sale\.id, admin\);\s*\}/m;

if (file2.match(regex2)) {
   file2 = file2.replace(regex2, replacement);
   fs.writeFileSync('app/routes/app.sales.$id.jsx', file2);
   console.log("Replaced in app.sales.$id.jsx");
} else {
   console.log("Could not find regex in app.sales.$id.jsx");
}

