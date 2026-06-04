const fs = require('fs');
let file = fs.readFileSync('app/routes/app.sales.new.jsx', 'utf8');

// Remove excludeCertainProducts state
const stateRegex = /const \[excludeCertainProducts, setExcludeCertainProducts\] = useState\(false\); \/\/ UI toggle only for now\s*/m;
if (file.match(stateRegex)) {
   file = file.replace(stateRegex, '');
}

// Remove checkbox UI
const checkboxRegex = /<Checkbox\s*label="Exclude certain products from sale"\s*checked=\{excludeCertainProducts\}\s*onChange=\{setExcludeCertainProducts\}\s*\/>/m;
if (file.match(checkboxRegex)) {
   file = file.replace(checkboxRegex, '');
}

fs.writeFileSync('app/routes/app.sales.new.jsx', file);
console.log("Cleaned up dead UI in new.jsx");

// Do the same for $id.jsx
let file2 = fs.readFileSync('app/routes/app.sales.$id.jsx', 'utf8');
if (file2.match(stateRegex)) {
   file2 = file2.replace(stateRegex, '');
}
if (file2.match(checkboxRegex)) {
   file2 = file2.replace(checkboxRegex, '');
}
fs.writeFileSync('app/routes/app.sales.$id.jsx', file2);
console.log("Cleaned up dead UI in $id.jsx");
