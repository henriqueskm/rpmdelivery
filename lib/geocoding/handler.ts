import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { geocodingProvider } from "../../services/geocoding/provider.ts";
import type { GeoPoint } from "../../services/geocoding/types.ts";

/**
 * Where the user's store is (RLS limits the read to their own stores), to bias the search toward
 * its city. A user in several stores gets the first one; no store yet (onboarding) means no bias.
 */
async function storeLocation(client: SupabaseClient): Promise<GeoPoint | undefined> {
  try {
    const { data } = await client.from("restaurants").select("latitude, longitude")
      .not("latitude", "is", null).not("longitude", "is", null).limit(1);
    const row: unknown = Array.isArray(data) ? data[0] : undefined;
    if (!row || typeof row !== "object") return undefined;
    const { latitude, longitude } = row as Record<string, unknown>;
    return typeof latitude === "number" && Math.abs(latitude) <= 90
      && typeof longitude === "number" && Math.abs(longitude) <= 180 ? { latitude, longitude } : undefined;
  } catch {
    return undefined;
  }
}

async function readInput(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  } finally { reader.releaseLock(); }
}

export async function handleGeocoding(request: Request, operation: "suggest" | "resolve") {
  const reply = (body: unknown, status = 200) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return reply({ message: "Requisição não permitida." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
    return reply({ message: "Formato inválido." }, 415);
  if (Number(request.headers.get("content-length")) > 2048)
    return reply({ message: "Requisição muito longa." }, 413);
  let input: string;
  try {
    const raw = await readInput(request);
    if (raw === null) return reply({ message: "Requisição muito longa." }, 413);
    const body: unknown = JSON.parse(raw);
    const value = body && typeof body === "object"
      ? (body as Record<string, unknown>)[operation === "suggest" ? "query" : "mapboxId"] : null;
    if (typeof value !== "string") throw new Error();
    input = value.trim();
    if (operation === "suggest" ? input.length < 3 || input.length > 200
      : !/^[A-Za-z0-9_-]{1,255}$/.test(input)) throw new Error();
  } catch {
    return reply({ message: "Informe um endereço válido." }, 400);
  }
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if (!token || token.length > 8192) return reply({ message: "Entre novamente para continuar." }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return reply({ message: "Busca indisponível no momento." }, 503);
  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` },
        fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }) },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return reply({ message: "Entre novamente para continuar." }, 401);
    const result = operation === "suggest"
      ? await geocodingProvider.suggest(input, request.signal, await storeLocation(client))
      : await geocodingProvider.resolve(input, request.signal);
    return reply(result);
  } catch {
    return reply({ message: "Não foi possível buscar o endereço. Tente novamente." }, 502);
  }
}
