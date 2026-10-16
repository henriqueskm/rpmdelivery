import type { Page } from "@playwright/test";
import { mockSupabase, testRestaurant } from "./supabase";
export const inviteCode = "abcdef1234567890abcd";
export async function mockInvitations(page: Page, options: { existingProfile?: boolean; unavailable?: boolean; operator?: boolean; signupSession?: boolean; longText?: boolean; legacyProfile?: "empty" | "partial"; incompleteAtRequest?: boolean } = {}) {
  const base = await mockSupabase(page, { existing: true, signupSession: options.signupSession });
  let registered = options.existingProfile ?? false;
  let profile = {
    name: options.legacyProfile ? "Nome já cadastrado" : registered ? "Motoboy fixture" : null,
    phone: options.legacyProfile ? "+5511999999999" : null,
    model: options.legacyProfile === "partial" || registered ? "Honda CG 160" : null,
    plate: registered ? "ABC1D23" : null,
    color: options.legacyProfile === "partial" || registered ? "Preta" : null,
  };
  let status = "PENDING", requested = false, active = true, generated = false;
  let invalidated = false;
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  await page.route("http://127.0.0.1:54321/rest/v1/rpc/**", async route => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    if (name === "create_restaurant") return route.fallback();
    const body = route.request().postDataJSON() ?? {};
    calls.push({ name, body });
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (options.operator && ["list_courier_management", "create_courier_invite", "review_courier_membership"].includes(name)) return reply({ code: "42501", message: "RPM_MANAGER_REQUIRED" }, 403);
    switch (name) {
      case "inspect_courier_invite": return reply(options.unavailable || !active ? { ok: false, reason: "unavailable" } : { ok: true, registered, profile, restaurantName: "Pizzaria da Vila" });
      case "complete_courier_registration": {
        if (Object.keys(body).some(key => !["p_name","p_phone","p_model","p_plate","p_color"].includes(key))) return reply({ code: "PGRST202" }, 404);
        const values = { name: profile.name ?? String(body.p_name ?? "").trim(), phone: profile.phone ?? String(body.p_phone ?? "").trim(), model: profile.model ?? String(body.p_model ?? "").trim(), plate: profile.plate ?? String(body.p_plate ?? "").trim().toUpperCase(), color: profile.color ?? String(body.p_color ?? "").trim() };
        if (!values.name || !values.model || !values.plate || !values.color) return reply({ code: "22023" }, 400);
        profile = values; registered = true; return reply("33333333-3333-4333-8333-333333333333");
      }
      case "request_courier_membership":
        if (options.incompleteAtRequest && registered && !invalidated) { registered = false; profile.plate = null; invalidated = true; }
        if (!registered) return reply({ ok: false, reason: "profile_required" });
        requested = true; return reply({ ok: true, status });
      case "list_my_establishments": return reply(requested ? [{ id: "44444444-4444-4444-8444-444444444444", restaurantName: "Pizzaria da Vila", status }, { id: "66666666-6666-4666-8666-666666666666", restaurantName: "Loja de outro bairro", status: "ACTIVE" }] : []);
      case "create_courier_invite": generated = true; return reply({ id: "55555555-5555-4555-8555-555555555555", code: inviteCode, active, expiresAt: new Date(Date.now()+3600000).toISOString(), maxUses: 20, usedCount: 0 });
      case "revoke_courier_invite": active = false; return reply(null);
      case "list_courier_management": return reply({ invites: generated ? [{ id: "55555555-5555-4555-8555-555555555555", code: inviteCode, active, expiresAt: new Date(Date.now()+3600000).toISOString(), maxUses: 20, usedCount: 0 }] : [], requests: status === "PENDING" ? [{ id: "44444444-4444-4444-8444-444444444444", name: options.longText ? "Motoboy com nome extenso ".repeat(5).slice(0,120) : "Motoboy de teste", motorcycleModel: options.longText ? "ModeloExtensoSemEspacos".repeat(4).slice(0,80) : "CG 160", motorcyclePlate: "ABC1D23", motorcycleColor: "Preta", requestedAt: new Date().toISOString() }] : [] });
      case "review_courier_membership": status = body.p_approve ? "ACTIVE" : "REJECTED"; return reply(status);
      default: return reply({ code: "PGRST202" }, 404);
    }
  });
  return { calls, base, restaurantId: testRestaurant.id };
}
