const fs = require('fs');
let file = fs.readFileSync('app/routes/app.proxy.js', 'utf8');

const regex = /const saleWithTimer = sales\.find\(\(s\) => s\.timer\);\s*responseData\.timer = saleWithTimer \? \{\s*\.\.\.saleWithTimer\.timer,\s*endTime: saleWithTimer\.endTime,\s*\} : null;/m;

const replacement = `const activeSale = sales[0];
  if (activeSale) {
    responseData.timer = {
       ...(activeSale.timer || {}),
       hasTimer: !!activeSale.timer,
       endTime: activeSale.endTime, // Always pass endTime just in case, but frontend checks hasTimer
       // Fallbacks if no timer is attached
       title: activeSale.timer ? activeSale.timer.name : activeSale.title,
       style: activeSale.timer ? activeSale.timer.style : JSON.stringify({
           backgroundColor: "#000000",
           titleColor: "#ffffff",
           timerColor: "#ffffff",
           labels: { days: "D", hours: "H", minutes: "M", seconds: "S" }
       })
    };
  } else {
    responseData.timer = null;
  }`;

if (file.match(regex)) {
   file = file.replace(regex, replacement);
   fs.writeFileSync('app/routes/app.proxy.js', file);
   console.log("Replaced proxy response logic");
} else {
   console.log("Could not find regex in app.proxy.js");
}
