export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const db = (await import("../db.server")).default;

  try {
    const { payload, session, topic, shop } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);
    const current = payload.current;

    if (session) {
      await db.session.update({
        where: {
          id: session.id,
        },
        data: {
          scope: current.toString(),
        },
      });
    }

    return new Response();
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(`[Webhook] Error handling webhook:`, error);
    return new Response("Webhook error", { status: 500 });
  }
};
