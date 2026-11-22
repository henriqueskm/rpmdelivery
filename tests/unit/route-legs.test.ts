import { test } from "node:test";
import assert from "node:assert/strict";
import { blockRequest, missingBlocks, MAX_BLOCKS } from "../../lib/routing/leg-blocks.ts";
import { handleRouteLegs } from "../../lib/routing/legs-handler.ts";
import { MatrixError } from "../../services/routing/mapbox-matrix.ts";

test("pede ao Mapbox só os trechos que faltam, em blocos de até 24 pontos", () => {
  // 3 points, nothing known: one block with everyone.
  assert.deepEqual(missingBlocks(3, () => false), [{ sources: [0, 1, 2], destinations: [0, 1, 2] }]);
  // Everything known: no request at all.
  assert.deepEqual(missingBlocks(3, () => true), []);
  // 30 points: chunks of 12, 12 and 6; only blocks with something missing are asked.
  const known = (i: number, j: number) => !(i === 29 || j === 29);
  const blocks = missingBlocks(30, known);
  assert.deepEqual(blocks.map(b => [b.sources[0], b.destinations[0]]), [[0, 24], [12, 24], [24, 0], [24, 12], [24, 24]]);
  for (const block of missingBlocks(60, () => false)) assert.ok(blockRequest(block).points.length <= 24);
  assert.equal(missingBlocks(60, () => false).length, MAX_BLOCKS);
});

test("cada bloco manda as coordenadas uma vez e aponta origens e destinos entre elas", () => {
  assert.deepEqual(blockRequest({ sources: [12, 13], destinations: [0, 1] }),
    { points: [12, 13, 0, 1], sources: [0, 1], destinations: [2, 3] });
  assert.deepEqual(blockRequest({ sources: [0, 1], destinations: [0, 1] }), { points: [0, 1], sources: [0, 1], destinations: [0, 1] });
});

const STORE = "11111111-1111-4111-8111-111111111111";
const points = [{ latitude: -23, longitude: -46.8 }, { latitude: -23.005, longitude: -46.8 }, { latitude: -23.03, longitude: -46.8 }];
const legsRequest = (body: unknown, headers: Record<string, string> = { authorization: "Bearer fake.test.signature" }) =>
  new Request("http://localhost/api/routing/legs", { method: "POST",
    headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** Fakes the store's RPCs at the Supabase URL; anything else fails the test. */
async function withSupabase(rpc: (name: string, body: unknown) => Response, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  const previous = keys.map(key => process.env[key]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-test-placeholder";
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    assert.ok(path.startsWith("/rest/v1/rpc/"), `only the store's RPCs are called directly: ${path}`);
    return rpc(path.slice("/rest/v1/rpc/".length), JSON.parse(String(init?.body ?? "null")));
  };
  try { await run(); } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
}

test("rota de trechos: valida entrada, origem e login", async () => {
  assert.equal((await handleRouteLegs(legsRequest({ restaurantId: "x", points }))).status, 400);
  assert.equal((await handleRouteLegs(legsRequest({ restaurantId: STORE, points: points.slice(0, 1) }))).status, 400);
  assert.equal((await handleRouteLegs(legsRequest({ restaurantId: STORE, points: [{ latitude: 91, longitude: 0 }, points[0]] }))).status, 400);
  assert.equal((await handleRouteLegs(legsRequest({ restaurantId: STORE, points }, {}))).status, 401);
  assert.equal((await handleRouteLegs(legsRequest({ restaurantId: STORE, points }, { origin: "https://evil.invalid" }))).status, 403);
});

test("rota de trechos: usa o cache, pede só o que falta, salva e responde a tabela inteira", async () => {
  const saved: unknown[] = [];
  const asked: { count: number; sources: number[]; destinations: number[] }[] = [];
  await withSupabase((name, body) => {
    if (name === "read_route_legs") return Response.json([{ from: 0, to: 1, seconds: 95, meters: 700 }]);
    if (name === "save_route_legs") { saved.push(body); return Response.json({ saved: 5 }); }
    return Response.json({ message: "unexpected" }, { status: 500 });
  }, async () => {
    const response = await handleRouteLegs(legsRequest({ restaurantId: STORE, points }), {
      fetchBlock: async (coordinates, sources, destinations) => {
        asked.push({ count: coordinates.length, sources, destinations });
        return { durations: sources.map(s => destinations.map(d => (s === d ? 0 : 100 + s * 10 + d))),
          distances: sources.map(s => destinations.map(d => (s === d ? 0 : 1000 + s * 10 + d))) };
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(asked, [{ count: 3, sources: [0, 1, 2], destinations: [0, 1, 2] }]);
    assert.equal(body.durations[0][1], 95, "the cached leg is kept, not replaced");
    assert.equal(body.durations[2][0], 120);
    assert.equal(body.fetched, 5);
    assert.equal(body.partial, false);
    const legs = saved[0] as { p_legs: { seconds: number }[]; p_restaurant_id: string };
    assert.equal(legs.p_restaurant_id, STORE);
    assert.equal(legs.p_legs.length, 5);
  });
});

test("rota de trechos: Mapbox fora do ar devolve o que se sabe; login inválido e outra loja são recusados", async () => {
  await withSupabase(name => (name === "read_route_legs" ? Response.json([]) : Response.json({})), async () => {
    const response = await handleRouteLegs(legsRequest({ restaurantId: STORE, points }), {
      fetchBlock: async () => { throw new MatrixError("rate-limit"); },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.partial, true);
    assert.equal(body.durations[0][1], null);
    assert.equal(JSON.stringify(body).includes("access_token"), false);
  });
  await withSupabase(() => Response.json({ message: "JWT expired" }, { status: 401 }), async () => {
    assert.equal((await handleRouteLegs(legsRequest({ restaurantId: STORE, points }))).status, 401);
  });
  await withSupabase(() => Response.json({ code: "42501", message: "RPM_MEMBER_REQUIRED" }, { status: 403 }), async () => {
    assert.equal((await handleRouteLegs(legsRequest({ restaurantId: STORE, points }))).status, 403);
  });
});
