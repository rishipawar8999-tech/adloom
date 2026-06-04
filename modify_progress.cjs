const fs = require('fs');
let file = fs.readFileSync('app/models/sale.server.js', 'utf8');

// 1. Initialize totalItems before loop
const initRegex = /const updatesByProduct = itemsToUpdate\.reduce\(\(acc, item\) => \{/m;
const initReplacement = `
    await prisma.sale.update({
      where: { id: saleId },
      data: { totalItems: itemsToUpdate.length, processedItems: 0 },
    });

    const updatesByProduct = itemsToUpdate.reduce((acc, item) => {`;

file = file.replace(initRegex, initReplacement);

// 2. Increment processedItems during loop
const loopRegex = /for \(const productId in updatesByProduct\) \{/m;
const loopReplacement = `let currentProcessed = 0;
    for (const productId in updatesByProduct) {`;
file = file.replace(loopRegex, loopReplacement);

const endLoopRegex = /} catch \(bulkError\) \{\s*console\.error\(`Error bulk updating product \$\{productId\}:`, bulkError\);\s*throw bulkError;\s*\}\s*\}/m;
const endLoopReplacement = `} catch (bulkError) {
        console.error(\`Error bulk updating product \${productId}:\`, bulkError);
        throw bulkError;
      }
      
      currentProcessed += updatesByProduct[productId].length;
      if (currentProcessed % 50 === 0 || currentProcessed === itemsToUpdate.length) {
         await prisma.sale.update({
            where: { id: saleId },
            data: { processedItems: currentProcessed }
         });
      }
    }`;
file = file.replace(endLoopRegex, endLoopReplacement);


fs.writeFileSync('app/models/sale.server.js', file);
console.log("Done");
