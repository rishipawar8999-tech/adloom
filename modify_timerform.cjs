const fs = require('fs');
let file = fs.readFileSync('app/components/TimerForm.jsx', 'utf8');

const importRegex = /import \{\s*FormLayout,\s*TextField,\s*Select,\s*Card,\s*Box,\s*Text,\s*BlockStack,\s*InlineStack,\s*Button,\s*RangeSlider,\s*Tabs,\s*Divider,\s*Banner,\s*Icon,\s*Modal,\s*Badge,\s*\}/m;
if (file.match(importRegex) && !file.includes('Checkbox')) {
    file = file.replace('Badge,', 'Badge, Checkbox,');
}

const defaultsRegex = /preset: "announcement",\s*\};/m;
if (file.match(defaultsRegex)) {
    file = file.replace(defaultsRegex, 'preset: "announcement",\n    showClock: true,\n  };');
}

const uiRegex = /<Box paddingBlockStart="400">\s*<Text variant="headingSm" as="h3">Time Labels \(Short\)<\/Text>\s*<\/Box>/m;
const uiReplacement = `<Box paddingBlockStart="400">
        <Checkbox 
           label="Show countdown clock" 
           helpText="If unchecked, this banner will only show the title and subtitle."
           checked={config.showClock} 
           onChange={(v) => handleConfigChange("showClock", v)} 
        />
      </Box>
      {config.showClock && (
      <>
      <Box paddingBlockStart="400">
        <Text variant="headingSm" as="h3">Time Labels (Short)</Text>
      </Box>`;

if (file.match(uiRegex)) {
   file = file.replace(uiRegex, uiReplacement);
}

const endLabelsRegex = /<TextField label="Minutes" value=\{config\.labels\.minutes\} onChange=\{\(v\) => handleLabelChange\("minutes", v\)\} autoComplete="off" \/>\s*<TextField label="Seconds" value=\{config\.labels\.seconds\} onChange=\{\(v\) => handleLabelChange\("seconds", v\)\} autoComplete="off" \/>\s*<\/div>/m;
const endLabelsReplacement = `<TextField label="Minutes" value={config.labels.minutes} onChange={(v) => handleLabelChange("minutes", v)} autoComplete="off" />
        <TextField label="Seconds" value={config.labels.seconds} onChange={(v) => handleLabelChange("seconds", v)} autoComplete="off" />
      </div>
      </>
      )}`;

if (file.match(endLabelsRegex)) {
   file = file.replace(endLabelsRegex, endLabelsReplacement);
}

const previewRegex = /\{config\.title && <div style=\{\{ fontWeight: "bold" \}\}>\{config\.title\}<\/div>\}\s*\{config\.subtitle && <div style=\{\{ opacity: 0\.9, fontSize: "0\.9em" \}\}>\{config\.subtitle\}<\/div>\}\s*<\/div>\s*<div style=\{\{ display: "flex", gap: "15px", alignItems: "center" \}\}>/m;
const previewReplacement = `{config.title && <div style={{ fontWeight: "bold" }}>{config.title}</div>}
                  {config.subtitle && <div style={{ opacity: 0.9, fontSize: "0.9em" }}>{config.subtitle}</div>}
                </div>
                {config.showClock && (
                <div style={{ display: "flex", gap: "15px", alignItems: "center" }}>`;

if (file.match(previewRegex)) {
   file = file.replace(previewRegex, previewReplacement);
}

const previewEndRegex = /<div style=\{\{ fontSize: "0\.7em", textTransform: "uppercase", opacity: 0\.7 \}\}>\{config\.labels\.seconds\}<\/div>\s*<\/div>\s*<\/div>/m;
const previewEndReplacement = `<div style={{ fontSize: "0.7em", textTransform: "uppercase", opacity: 0.7 }}>{config.labels.seconds}</div>
                  </div>
                </div>
                )}`;

if (file.match(previewEndRegex)) {
    file = file.replace(previewEndRegex, previewEndReplacement);
}

fs.writeFileSync('app/components/TimerForm.jsx', file);
console.log("Updated TimerForm.jsx");
