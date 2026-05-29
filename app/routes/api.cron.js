import { json } from "@remix-run/node";
import { runCronTasks } from "../cron.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret") || request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;
  
  if (!expectedSecret) {
    return json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  if (secret !== expectedSecret) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runCronTasks();

  return json({
    success: true,
    startedCount: results.started.length,
    endedCount: results.ended.length,
    results
  });
}
