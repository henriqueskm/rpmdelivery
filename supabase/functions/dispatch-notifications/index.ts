// POST { routeId } with the signed-in user's JWT (courier of the route or
// store member). Sends the route's pending customer messages and records each
// result:
//   - WhatsApp through Meta's Cloud API ("saiu para entrega", "você é o próximo");
//   - browser notifications (web push) to the customers who turned them on in
//     the tracking page ("saiu", "você é o próximo", "está chegando", "entregue").
// Each channel runs only when its settings exist. The response carries only
// counts: never a customer phone or browser address.
import {
  classifyMetaResponse,
  readWhatsAppConfig,
  messageFor,
  type ClaimedNotification,
  type SendOutcome,
} from "../_shared/whatsapp.ts";
import {
  PUSH_ENDPOINT,
  classifyPushResponse,
  combinePushOutcomes,
  pushMessage,
  pushRequest,
  readPushConfig,
  type ClaimedPush,
  type PushConfig,
  type PushOutcome,
} from "../_shared/webpush.ts";

type DenoRuntime = {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};
const runtime = (globalThis as unknown as { Deno: DenoRuntime }).Deno;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

async function rpc(baseUrl: string, serviceKey: string, name: string, args: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, payload };
}

async function sendWhatsApp(config: NonNullable<ReturnType<typeof readWhatsAppConfig>>, item: ClaimedNotification): Promise<SendOutcome> {
  let message;
  try {
    message = messageFor(config, item);
  } catch (error) {
    return { outcome: "FAILED", error: error instanceof Error ? error.message : "INVALID_MESSAGE" };
  }
  try {
    const response = await fetch(message.url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify(message.body),
    });
    return classifyMetaResponse(response.status, await response.json().catch(() => null));
  } catch {
    return { outcome: "RETRY", error: "META_UNREACHABLE" };
  }
}

/** One notification to every browser of the order; a browser the push service no longer knows is switched off. */
async function sendPush(baseUrl: string, serviceKey: string, config: PushConfig, item: ClaimedPush): Promise<SendOutcome> {
  let message;
  try {
    message = pushMessage(item);
  } catch (error) {
    return { outcome: "FAILED", error: error instanceof Error ? error.message : "INVALID_MESSAGE" };
  }
  const results: PushOutcome[] = [];
  for (const subscription of item.subscriptions ?? []) {
    if (!PUSH_ENDPOINT.test(subscription.endpoint)) { results.push({ outcome: "FAILED", error: "INVALID_ENDPOINT" }); continue; }
    try {
      const request = await pushRequest(config, subscription, message, item.trackingToken);
      const response = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(10_000) });
      await response.body?.cancel();
      const result = classifyPushResponse(response.status);
      if (result.outcome === "GONE") {
        await rpc(baseUrl, serviceKey, "revoke_push_subscription", { p_subscription_id: subscription.id });
      }
      results.push(result);
    } catch {
      results.push({ outcome: "RETRY", error: "PUSH_UNREACHABLE" });
    }
  }
  return combinePushOutcomes(results);
}

runtime.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const baseUrl = runtime.env.get("SUPABASE_URL");
  const serviceKey = runtime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const whatsapp = readWhatsAppConfig((name) => runtime.env.get(name));
  const push = readPushConfig((name) => runtime.env.get(name));
  if (!baseUrl || !serviceKey || (!whatsapp && !push)) return reply(503, { error: "NOTIFICATIONS_NOT_CONFIGURED" });

  const jwt = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "RPM_AUTH_REQUIRED" });
  const auth = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, authorization: `Bearer ${jwt}` } });
  const user = auth.ok ? await auth.json().catch(() => null) : null;
  if (typeof user?.id !== "string") return reply(401, { error: "RPM_AUTH_REQUIRED" });

  const input = await request.json().catch(() => null);
  const routeId = input?.routeId;
  if (typeof routeId !== "string" || !UUID.test(routeId)) return reply(400, { error: "RPM_ROUTE_FIELDS" });

  const counts = { sent: 0, retry: 0, failed: 0 };
  const record = async (notificationId: string, result: SendOutcome) => {
    await rpc(baseUrl, serviceKey, "complete_notification", {
      p_notification_id: notificationId,
      p_outcome: result.outcome,
      p_provider_message_id: result.providerMessageId ?? null,
      p_error: result.error ?? null,
    });
    counts[result.outcome === "SENT" ? "sent" : result.outcome === "RETRY" ? "retry" : "failed"] += 1;
  };

  const channels: [string, (items: unknown[]) => Promise<void>][] = [];
  if (whatsapp) channels.push(["claim_route_notifications", async (items) => {
    for (const item of items as ClaimedNotification[]) await record(item.notificationId, await sendWhatsApp(whatsapp, item));
  }]);
  if (push) channels.push(["claim_route_push", async (items) => {
    for (const item of items as ClaimedPush[]) await record(item.notificationId, await sendPush(baseUrl, serviceKey, push, item));
  }]);

  for (const [claimName, send] of channels) {
    const claim = await rpc(baseUrl, serviceKey, claimName, { p_user_id: user.id, p_route_id: routeId });
    if (!claim.ok) {
      const notFound = claim.payload?.message === "RPM_ROUTE_NOT_FOUND";
      return reply(notFound ? 404 : 500, { error: notFound ? "RPM_ROUTE_NOT_FOUND" : "RPM_DISPATCH_FAILED" });
    }
    await send(Array.isArray(claim.payload) ? claim.payload : []);
  }
  return reply(200, counts);
});
