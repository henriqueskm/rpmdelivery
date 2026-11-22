import "server-only";
import { createClient } from "@supabase/supabase-js";
import { fetchMatrixBlock, MatrixError } from "../../services/routing/mapbox-matrix.ts";
import { blockRequest, missingBlocks } from "./leg-blocks.ts";

/**
 * POST /api/routing/legs — street times among the store and its waiting orders, for "Sugerir rotas".
 * Body: { restaurantId, points: [{latitude, longitude}] } (2–60 points, the store first).
 * Reads what the store already has (read_route_legs, members only), asks Mapbox only for the legs
 * still missing, saves them (save_route_legs) and answers the full table, with null where no time
 * is known: the panel estimates those. Never returns the token, provider bodies or URLs.
 */
const MAX_POINTS = 60;
const MAX_BODY = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Point = { latitude: number; longitude: number };
const isPoint = (value: unknown): value is Point => {
  if (!value || typeof value !== "object") return false;
  const { latitude, longitude } = value as Record<string, unknown>;
  return typeof latitude === "number" && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === "number" && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
};

export async function handleRouteLegs(request: Request, { fetchBlock = fetchMatrixBlock } = {}) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply({ message: "Requisição não permitida." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
    return reply({ message: "Formato inválido." }, 415);
  if (Number(request.headers.get("content-length")) > MAX_BODY) return reply({ message: "Requisição muito longa." }, 413);

  let restaurantId: string, points: Point[];
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return reply({ message: "Requisição muito longa." }, 413);
    const body = JSON.parse(text) as Record<string, unknown>;
    if (typeof body.restaurantId !== "string" || !UUID.test(body.restaurantId)) throw new Error();
    if (!Array.isArray(body.points) || body.points.length < 2 || body.points.length > MAX_POINTS || !body.points.every(isPoint))
      throw new Error();
    restaurantId = body.restaurantId;
    points = body.points.map(p => ({ latitude: p.latitude, longitude: p.longitude }));
  } catch {
    return reply({ message: "Pontos inválidos." }, 400);
  }

  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if (!token || token.length > 8192) return reply({ message: "Entre novamente para continuar." }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return reply({ message: "Tempos pelas ruas indisponíveis no momento." }, 503);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` },
      fetch: (target, init) => fetch(target, { ...init, signal: AbortSignal.timeout(8000) }) },
  });

  const n = points.length;
  const durations: (number | null)[][] = points.map((_, i) => points.map((__, j) => (i === j ? 0 : null)));
  const distances: (number | null)[][] = points.map((_, i) => points.map((__, j) => (i === j ? 0 : null)));
  const cached = await client.rpc("read_route_legs", { p_restaurant_id: restaurantId, p_points: points });
  if (cached.error) {
    // An invalid or expired login is refused by PostgREST (401); another store's id by the RPC (403).
    if (cached.status === 401 || /RPM_AUTH_REQUIRED/.test(cached.error.message ?? ""))
      return reply({ message: "Entre novamente para continuar." }, 401);
    if (cached.status === 403 || /RPM_MEMBER_REQUIRED/.test(cached.error.message ?? ""))
      return reply({ message: "Esta loja não é sua." }, 403);
    return reply({ message: "Tempos pelas ruas indisponíveis no momento." }, 503);
  }
  for (const leg of Array.isArray(cached.data) ? cached.data as Record<string, unknown>[] : []) {
    const from = leg.from, to = leg.to;
    if (typeof from === "number" && typeof to === "number" && from >= 0 && from < n && to >= 0 && to < n
      && typeof leg.seconds === "number" && typeof leg.meters === "number") {
      durations[from][to] = leg.seconds; distances[from][to] = leg.meters;
    }
  }

  const fresh: Record<string, number>[] = [];
  let partial = false;
  for (const block of missingBlocks(n, (i, j) => durations[i][j] !== null)) {
    const request = blockRequest(block);
    try {
      const answer = await fetchBlock(request.points.map(i => points[i]), request.sources, request.destinations);
      block.sources.forEach((from, s) => block.destinations.forEach((to, d) => {
        const seconds = answer.durations[s][d], meters = answer.distances[s][d];
        if (from === to || seconds === null || meters === null || durations[from][to] !== null) return;
        durations[from][to] = Math.round(seconds); distances[from][to] = Math.round(meters);
        fresh.push({ fromLatitude: points[from].latitude, fromLongitude: points[from].longitude,
          toLatitude: points[to].latitude, toLongitude: points[to].longitude,
          seconds: Math.round(seconds), meters: Math.round(meters) });
      }));
    } catch (error) {
      // Rate limit, timeout or outage: answer what is known; the panel estimates the rest.
      partial = true;
      if (error instanceof MatrixError && ["rate-limit", "unavailable", "timeout"].includes(error.code)) break;
    }
  }
  if (missingBlocks(n, (i, j) => durations[i][j] !== null).length) partial = true;
  // Saving is best effort: a failure only means asking Mapbox again next time.
  if (fresh.length) await client.rpc("save_route_legs", { p_restaurant_id: restaurantId, p_legs: fresh });
  return reply({ durations, distances, fetched: fresh.length, partial });
}
