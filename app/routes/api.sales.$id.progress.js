import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request, params }) {
  await authenticate.admin(request);
  const saleId = params.id;

  if (!saleId) {
    return json({ error: "Missing sale ID" }, { status: 400 });
  }

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: { status: true, processedItems: true, totalItems: true },
  });

  if (!sale) {
    return json({ error: "Sale not found" }, { status: 404 });
  }

  return json({
    status: sale.status,
    processedItems: sale.processedItems,
    totalItems: sale.totalItems,
  });
}
