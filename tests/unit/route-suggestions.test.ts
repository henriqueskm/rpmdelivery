import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SUGGESTION_PARAMETERS, estimateLeg, normalizePlace, relation, splitAddress, suggestRoutes,
  type SuggestionOrder,
} from "../../features/route-planning/grouping.ts";

const NOW = Date.UTC(2026, 10, 22, 15, 0);
const store = { latitude: -23.0, longitude: -46.8 };
const order = (id: string, address: string, neighborhood: string, latitude: number | null, longitude: number,
  minutes = 60): SuggestionOrder => ({
  id, reference: id, address, neighborhood, createdAt: NOW - 60_000, deadlineAt: NOW + minutes * 60_000,
  ...(latitude === null ? {} : { location: { latitude, longitude } }),
});

test("endereços e bairros escritos de jeitos diferentes viram o mesmo lugar", () => {
  assert.equal(normalizePlace("Jd. Paulista"), normalizePlace("Jardim  Paulista"));
  assert.equal(normalizePlace("Vl São José"), "vila sao jose");
  assert.deepEqual(splitAddress("R. das Acácias, 55 - Apto 3"), { street: "rua das acacias", number: "55" });
  assert.deepEqual(splitAddress("Av Brasil"), { street: "avenida brasil", number: "" });
  const a = order("a", "Rua das Acácias, 55", "Centro", -23.005, -46.8);
  assert.equal(relation(a, order("b", "R. das Acacias, 55", "", null, 0), DEFAULT_SUGGESTION_PARAMETERS)?.reason, "same-address");
  assert.equal(relation(a, order("c", "Rua das Acácias, 300", "Outro", null, 0), DEFAULT_SUGGESTION_PARAMETERS)?.reason, "same-street");
  assert.equal(relation(a, order("d", "Rua Um, 1", "centro", null, 0), DEFAULT_SUGGESTION_PARAMETERS)?.reason, "same-neighborhood");
  // Neighbor bairros: 1.5 km between the two deliveries, no more.
  assert.equal(relation(a, order("e", "Rua Dois, 2", "Vila Nova", -23.015, -46.8), DEFAULT_SUGGESTION_PARAMETERS)?.reason, "neighbor");
  assert.equal(relation(a, order("f", "Rua Três, 3", "Vila Nova", -23.03, -46.8), DEFAULT_SUGGESTION_PARAMETERS), null);
});

test("junta por endereço, rua, bairro, bairro vizinho e no caminho; sem pino o pedido não é adivinhado", () => {
  const orders = [
    order("A", "Rua das Acácias, 55", "Centro", -23.005, -46.8, 30),
    order("B", "Rua das Acácias, 140", "Centro", -23.0058, -46.8003, 40),
    order("C", "R. das Acacias, 55", "Centro", -23.00502, -46.80001, 45),
    order("D", "Rua Sete, 10", "Jd. Paulista", -23.02, -46.8, 50),
    order("E", "Rua Oito, 20", "Jardim Paulista", -23.021, -46.801, 55),
    order("F", "Rua Nove, 30", "Vila Nova", -23.03, -46.8, 60),
    // East, 3.6 km and 7.2 km away: different bairros, too far to be neighbors, one on the way of the other.
    order("G", "Rua Leste, 1", "Bela Vista", -23.0, -46.765, 50),
    order("H", "Rua Longe, 2", "Fazenda", -23.0, -46.73, 70),
    order("I", "Rua Sem Pino, 3", "Centro", null, 0, 35),
  ];
  const result = suggestRoutes(store, orders, NOW);
  assert.deepEqual(result.withoutLocation, ["I"]);
  assert.equal(result.suggestions.length, 2);
  const [south, east] = result.suggestions;
  assert.deepEqual([...south.stops.map(s => s.id)].sort(), ["A", "B", "C", "D", "E", "F"]);
  const why = Object.fromEntries(south.stops.map(s => [s.id, s]));
  assert.equal(why.A.reason, undefined, "the route is built around the most urgent order");
  assert.equal(why.C.reason, "same-address"); assert.equal(why.C.with, "A");
  assert.equal(why.B.reason, "same-street");
  assert.equal(why.E.reason, "same-neighborhood"); assert.equal(why.E.with, "D");
  assert.equal(why.F.reason, "neighbor"); assert.ok(why.F.meters! <= 1500);
  assert.equal(south.lateCount, 0);
  // The stops leave in the fastest order: the near street first, then further south.
  assert.deepEqual(south.stops.slice(0, 3).map(s => s.id).sort(), ["A", "B", "C"]);

  assert.deepEqual(east.stops.map(s => s.id), ["G", "H"]);
  const rider = east.stops.find(s => s.reason === "on-the-way")!;
  assert.ok(rider.detourSeconds !== undefined && rider.detourSeconds <= 420);
  assert.deepEqual(suggestRoutes(store, orders, NOW), result, "the same orders always give the same suggestion");
});

test("no máximo 8 entregas por rota; o resto vira outra rota", () => {
  const street = Array.from({ length: 10 }, (_, i) =>
    order(`s${i}`, `Rua Comprida, ${10 + i}`, "Centro", -23.004 - i * 0.0002, -46.8, 60 + i));
  const result = suggestRoutes(store, street, NOW);
  assert.deepEqual(result.suggestions.map(s => s.stops.length), [8, 2]);
  assert.deepEqual(suggestRoutes(store, street, NOW, { ...DEFAULT_SUGGESTION_PARAMETERS, maxStops: 4 })
    .suggestions.map(s => s.stops.length), [4, 4, 2]);
});

test("um pedido que atrasaria outro não entra, mesmo na mesma rua", () => {
  // S is on time alone (just under 5 min); X too (under 8 min), but together one of them is late.
  const s = order("S", "Rua Curta, 10", "Centro", -23.0045, -46.8, 5);
  const x = order("X", "Rua Curta, 900", "Centro", -23.0126, -46.8, 8);
  assert.ok(estimateLeg(store, s.location!).seconds + 180 < 300);
  const result = suggestRoutes(store, [s, x], NOW);
  assert.deepEqual(result.suggestions.map(r => r.stops.map(stop => stop.id)), [["S"], ["X"]]);
});

test("desvio acima de 7 minutos não entra, a não ser no mesmo endereço", () => {
  // Opposite directions: 2.2 km north and 3.3 km south ride about 6 km more than the longer trip alone.
  const north = order("N", "Rua Norte, 1", "Norte", -22.98, -46.8);
  const south = order("S", "Rua Sul, 1", "Sul", -23.03, -46.8);
  assert.deepEqual(suggestRoutes(store, [north, south], NOW).suggestions.map(r => r.stops.length), [1, 1]);
  const wide = { ...DEFAULT_SUGGESTION_PARAMETERS, maxDetourSeconds: 60 * 60 };
  assert.deepEqual(suggestRoutes(store, [north, south], NOW, wide).suggestions.map(r => r.stops.length), [2]);
  // The same building always rides along, whatever the detour limit.
  const strict = { ...DEFAULT_SUGGESTION_PARAMETERS, maxDetourSeconds: 0 };
  const twin = order("T", "R. Norte, 1", "Norte", -22.98, -46.8);
  assert.deepEqual(suggestRoutes(store, [north, twin, south], NOW, strict).suggestions.map(r => r.stops.length), [2, 1]);
});

test("com tempos das ruas: um rio entre dois bairros vizinhos separa as rotas; sem o tempo, vale a estimativa", async () => {
  const { streetLegs, parseStreetTable } = await import("../../features/route-planning/street-legs.ts");
  const a = order("A", "Rua Um, 1", "Centro", -23.01, -46.8);
  const b = order("B", "Rua Dois, 2", "Outro Lado", -23.01, -46.787);
  // 1.3 km apart: neighbors, and together by the estimate.
  assert.deepEqual(suggestRoutes(store, [a, b], NOW).suggestions.map(r => r.stops.length), [2]);
  // On the streets the only bridge is far: 25 min from A to B, and from the store to B.
  const points = [store, a.location!, b.location!];
  const table = parseStreetTable({ partial: false,
    durations: [[0, 200, 1500], [200, 0, 1500], [1500, 1500, 0]],
    distances: [[0, 1400, 9000], [1400, 0, 9000], [9000, 9000, 0]] }, 3)!;
  const streets = streetLegs(points, table);
  const result = suggestRoutes(store, [a, b], NOW, DEFAULT_SUGGESTION_PARAMETERS, streets);
  assert.deepEqual(result.suggestions.map(r => r.stops.length), [2], "B rides along: 25 min to B is the trip anyway");
  // Opposite bank AND the other way round: now the detour is real and B goes alone.
  const detour = parseStreetTable({ partial: false,
    durations: [[0, 200, 600], [200, 0, 1800], [600, 1800, 0]],
    distances: [[0, 1400, 4000], [1400, 0, 12000], [4000, 12000, 0]] }, 3)!;
  assert.deepEqual(suggestRoutes(store, [a, b], NOW, DEFAULT_SUGGESTION_PARAMETERS, streetLegs(points, detour))
    .suggestions.map(r => r.stops.length), [1, 1]);
  // An unknown leg (null) falls back to the estimate; a malformed table is refused.
  const unknown = parseStreetTable({ durations: [[0, null, null], [null, 0, null], [null, null, 0]],
    distances: [[0, null, null], [null, 0, null], [null, null, 0]], partial: true }, 3)!;
  assert.equal(unknown.partial, true);
  assert.deepEqual(suggestRoutes(store, [a, b], NOW, DEFAULT_SUGGESTION_PARAMETERS, streetLegs(points, unknown)),
    suggestRoutes(store, [a, b], NOW));
  assert.equal(parseStreetTable({ durations: [[0]], distances: [[0]] }, 3), null);
});

test("motoboy livre sobrando: a rota mais longa é dividida em duas, sem separar o mesmo endereço", () => {
  // Two orders south and two east, together in one route when the detour is wide.
  const wide = { ...DEFAULT_SUGGESTION_PARAMETERS, maxDetourSeconds: 60 * 60 };
  const orders = [
    order("A", "Rua Sul, 10", "Sul", -23.02, -46.8, 30),
    order("B", "Rua Baixa, 20", "Sul", -23.025, -46.8, 40),
    order("C", "Rua Leste, 30", "Leste", -23.0, -46.775, 50),
    order("D", "Rua Nascente, 40", "Leste", -23.0, -46.77, 60),
  ];
  const ids = (result: ReturnType<typeof suggestRoutes>) => result.suggestions.map(s => s.stops.map(stop => stop.id).sort());
  // One courier (or none counted): one route, as before.
  assert.deepEqual(ids(suggestRoutes(store, orders, NOW, wide)), [["A", "B", "C", "D"]]);
  assert.deepEqual(ids(suggestRoutes(store, orders, NOW, wide, undefined, undefined, 1)), [["A", "B", "C", "D"]]);
  assert.equal(suggestRoutes(store, orders, NOW, wide, undefined, undefined, 1).suggestions[0].split, undefined);

  // Two couriers: south with one, east with the other; the more urgent part first.
  const two = suggestRoutes(store, orders, NOW, wide, undefined, undefined, 2);
  assert.deepEqual(ids(two), [["A", "B"], ["C", "D"]]);
  const [south, east] = two.suggestions;
  assert.equal(south.split?.from, "A"); assert.equal(east.split?.from, "A");
  assert.ok(east.split!.soonerSeconds > 5 * 60, "the east customers no longer wait for the south ones");
  // The reasons are told again inside each part.
  const why = Object.fromEntries(east.stops.map(s => [s.id, s]));
  assert.equal(why.C.reason, undefined, "C is the base of its own route now");
  assert.equal(why.D.reason, "same-neighborhood"); assert.equal(why.D.with, "C");
  assert.ok(south.durationSeconds < suggestRoutes(store, orders, NOW, wide).suggestions[0].durationSeconds);

  // More couriers than orders: one each.
  assert.deepEqual(ids(suggestRoutes(store, orders, NOW, wide, undefined, undefined, 6)), [["A"], ["B"], ["C"], ["D"]]);

  // The same building is never parted, whatever the couriers.
  const twin = order("T", "R. Sul, 10", "Sul", -23.02, -46.8, 35);
  assert.deepEqual(ids(suggestRoutes(store, [orders[0], twin, orders[2]], NOW, wide, undefined, undefined, 3)), [["A", "T"], ["C"]]);
  assert.deepEqual(suggestRoutes(store, orders, NOW, wide, undefined, undefined, 2), two, "always the same split");
});
