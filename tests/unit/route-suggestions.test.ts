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
  // Neighbor bairros: 2 km between the two deliveries, no more.
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
  assert.equal(why.F.reason, "neighbor"); assert.ok(why.F.meters! <= 2000);
  assert.equal(south.lateCount, 0);
  // The stops leave in the fastest order: the near street first, then further south.
  assert.deepEqual(south.stops.slice(0, 3).map(s => s.id).sort(), ["A", "B", "C"]);

  assert.deepEqual(east.stops.map(s => s.id), ["G", "H"]);
  const rider = east.stops.find(s => s.reason === "on-the-way")!;
  assert.ok(rider.detourSeconds !== undefined && rider.detourSeconds <= 600);
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

test("desvio acima de 10 minutos não entra, a não ser no mesmo endereço", () => {
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
