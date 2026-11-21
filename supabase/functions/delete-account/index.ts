// POST with the signed-in courier's JWT: "Excluir minha conta" in the app.
// 1. erase_courier_account (service_role): the person's data goes, the stores' records stay
//    without the name. Refused while a shift is open or when the login is also a store's.
// 2. GoTrue admin soft delete: the login is closed for good (identities and sessions removed,
//    email obfuscated). The user row stays so the stores' records keep pointing somewhere.
// Both steps can run again: a retry after a failure in step 2 finishes the job.
// The response carries only a code, never personal data.
type DenoRuntime = {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};
const runtime = (globalThis as unknown as { Deno: DenoRuntime }).Deno;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
/** Refusals the app explains to the courier; anything else is a plain failure. */
const REFUSALS = new Set(["RPM_ACCOUNT_SHIFT_OPEN", "RPM_ACCOUNT_STORE_MEMBER"]);

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

runtime.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const baseUrl = runtime.env.get("SUPABASE_URL");
  const serviceKey = runtime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceKey) return reply(503, { error: "DELETE_UNAVAILABLE" });
  const service = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };

  const jwt = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "RPM_AUTH_REQUIRED" });
  const auth = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, authorization: `Bearer ${jwt}` } });
  const user = auth.ok ? await auth.json().catch(() => null) : null;
  if (typeof user?.id !== "string") return reply(401, { error: "RPM_AUTH_REQUIRED" });

  const erase = await fetch(`${baseUrl}/rest/v1/rpc/erase_courier_account`, {
    method: "POST", headers: service, body: JSON.stringify({ p_user_id: user.id }),
  });
  if (!erase.ok) {
    const payload = await erase.json().catch(() => null);
    const code = typeof payload?.message === "string" ? payload.message : "";
    return REFUSALS.has(code) ? reply(409, { error: code }) : reply(500, { error: "DELETE_FAILED" });
  }

  const remove = await fetch(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method: "DELETE", headers: service, body: JSON.stringify({ should_soft_delete: true }),
  });
  await remove.body?.cancel();
  // Already gone (a retry): the job is done.
  if (!remove.ok && remove.status !== 404) return reply(500, { error: "DELETE_FAILED" });
  return reply(200, { deleted: true });
});
