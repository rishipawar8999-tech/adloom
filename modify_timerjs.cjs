const fs = require('fs');
let file = fs.readFileSync('extensions/timer-theme-extension/assets/timer.js', 'utf8');

// Modifying the HTML injection logic
const htmlRegex = /html \+= \`<div style="display: flex; gap: 15px; align-items: center;">\`;\s*const labels = config\.labels \|\| \{ days: "D", hours: "H", minutes: "M", seconds: "S" \};\s*\["days", "hours", "minutes", "seconds"\]\.forEach\(unit => \{\s*html \+= \`\s*<div style="text-align: center; line-height: 1;">\s*<div class="rockit-\$\{unit\}" style="font-weight: 800; font-family: monospace; font-size: 1\.1em;">00<\/div>\s*<div style="font-size: 0\.7em; text-transform: uppercase; opacity: 0\.7;">\$\{labels\[unit\]\}<\/div>\s*<\/div>\s*\`;\s*\}\);\s*html \+= \`<\/div><\/div>\`;/m;

const htmlReplacement = `if (timerData.hasTimer !== false) {
           html += \`<div style="display: flex; gap: 15px; align-items: center;">\`;
           const labels = config.labels || { days: "D", hours: "H", minutes: "M", seconds: "S" };
           ["days", "hours", "minutes", "seconds"].forEach(unit => {
             html += \`
               <div style="text-align: center; line-height: 1;">
                 <div class="rockit-\${unit}" style="font-weight: 800; font-family: monospace; font-size: 1.1em;">00</div>
                 <div style="font-size: 0.7em; text-transform: uppercase; opacity: 0.7;">\${labels[unit]}</div>
               </div>
             \`;
           });
           html += \`</div>\`;
        }
        html += \`</div>\`;`;

if (file.match(htmlRegex)) {
   file = file.replace(htmlRegex, htmlReplacement);
} else {
   console.log("Could not find html block regex in timer.js");
}

const intervalRegex = /updateTimer\(\);\s*const interval = setInterval\(updateTimer, 1000\);/m;
const intervalReplacement = `if (timerData.hasTimer !== false) {
           updateTimer();
           const interval = setInterval(updateTimer, 1000);
        }`;

if (file.match(intervalRegex)) {
   file = file.replace(intervalRegex, intervalReplacement);
} else {
    console.log("Could not find interval block regex in timer.js");
}

fs.writeFileSync('extensions/timer-theme-extension/assets/timer.js', file);
console.log("Done timer.js modifications");
