// POST { routeId } with the signed-in user's JWT (courier of the route or
// store member). Sends the route's pending "saiu para entrega" WhatsApp
// messages through Meta's Cloud API and records each result.
// The response carries only counts: never a customer phone.
import {
  classifyMetaResponse,
  readWhatsAppConfig,
  routeStartedMessage,
  type ClaimedNotification,
  type SendOutcome,
} from "../_shared/whatsapp.ts";

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

async function send(config: NonNullable<ReturnType<typeof readWhatsAppConfig>>, item: ClaimedNotification): Promise<SendOutcome> {
  let message;
  try {
    message = routeStartedMessage(config, item);
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

runtime.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const baseUrl = runtime.env.get("SUPABASE_URL");
  const serviceKey = runtime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const config = readWhatsAppConfig((name) => runtime.env.get(name));
  if (!baseUrl || !serviceKey || !config) return reply(503, { error: "WHATSAPP_NOT_CONFIGURED" });

  const jwt = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "RPM_AUTH_REQUIRED" });
  const auth = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, authorization: `Bearer ${jwt}` } });
  const user = auth.ok ? await auth.json().catch(() => null) : null;
  if (typeof user?.id !== "string") return reply(401, { error: "RPM_AUTH_REQUIRED" });

  const input = await request.json().catch(() => null);
  const routeId = input?.routeId;
  if (typeof routeId !== "string" || !UUID.test(routeId)) return reply(400, { error: "RPM_ROUTE_FIELDS" });

  const claim = await rpc(baseUrl, serviceKey, "claim_route_notifications", { p_user_id: user.id, p_route_id: routeId });
  if (!claim.ok) {
    const notFound = claim.payload?.message === "RPM_ROUTE_NOT_FOUND";
    return reply(notFound ? 404 : 500, { error: notFound ? "RPM_ROUTE_NOT_FOUND" : "RPM_DISPATCH_FAILED" });
  }

  const counts = { sent: 0, retry: 0, failed: 0 };
  for (const item of (claim.payload ?? []) as ClaimedNotification[]) {
    const result = await send(config, item);
    await rpc(baseUrl, serviceKey, "complete_notification", {
      p_notification_id: item.notificationId,
      p_outcome: result.outcome,
      p_provider_message_id: result.providerMessageId ?? null,
      p_error: result.error ?? null,
    });
    counts[result.outcome === "SENT" ? "sent" : result.outcome === "RETRY" ? "retry" : "failed"] += 1;
  }
  return reply(200, counts);
});
