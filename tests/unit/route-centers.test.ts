import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SUGGESTION_PARAMETERS, neighborhoodCenters, relation, suggestRoutes, type SuggestionOrder,
} from "../../features/route-planning/grouping.ts";
import { reasonText, splitText } from "../../features/operations/live/route-suggestions-text.ts";
import { freeCourierNotice } from "../../features/operations/live/free-courier.ts";

const NOW = Date.UTC(2026, 10, 22, 15, 0);
const store = { latitude: -23.0, longitude: -46.8 };
const order = (id: string, address: string, neighborhood: string, latitude: number, longitude: number): SuggestionOrder => ({
  id, reference: id, address, neighborhood, createdAt: NOW, deadlineAt: NOW + 60 * 60_000, location: { latitude, longitude },
});

test("bairros vizinhos pelo centro aprendido com o histórico da loja", () => {
  const centers = neighborhoodCenters([
    { neighborhood: "Jd. Paulista", latitude: -23.02, longitude: -46.8, orders: 3 },
    { neighborhood: "Jardim Paulista", latitude: -23.04, longitude: -46.8, orders: 1 },
    { neighborhood: "Vila Nova", latitude: -23.035, longitude: -46.8, orders: 5 },
    { neighborhood: "Longe", latitude: -23.2, longitude: -46.8, orders: 2 },
    { neighborhood: "", latitude: 0, longitude: 0, orders: 9 },
  ]);
  // Spellings that normalize alike are one bairro, weighted by how many orders each had.
  assert.equal(centers.size, 3);
  assert.ok(Math.abs(centers.get("jardim paulista")!.latitude - -23.025) < 1e-9);
  // Two orders 3 km apart, in bairros whose centers are 1.1 km apart: neighbors by the centers.
  const a = order("A", "Rua Um, 1", "Jardim Paulista", -23.01, -46.8);
  const b = order("B", "Rua Dois, 2", "Vila Nova", -23.037, -46.8);
  assert.equal(relation(a, b, DEFAULT_SUGGESTION_PARAMETERS), null, "3 km apart and no history: not neighbors");
  const learned = relation(a, b, DEFAULT_SUGGESTION_PARAMETERS, centers)!;
  assert.equal(learned.reason, "neighbor"); assert.equal(learned.learned, true); assert.ok(learned.meters! < 1200);
  // Centers far apart: not neighbors, even when these two orders happen to be close.
  const near = order("C", "Rua Três, 3", "Longe", -23.012, -46.8);
  assert.equal(relation(a, near, DEFAULT_SUGGESTION_PARAMETERS, centers), null);
  // A bairro without history falls back to the distance between the two orders.
  const fresh = order("D", "Rua Quatro, 4", "Bairro Novo", -23.015, -46.8);
  assert.equal(relation(a, fresh, DEFAULT_SUGGESTION_PARAMETERS, centers)?.reason, "neighbor");
  assert.equal(relation(a, fresh, DEFAULT_SUGGESTION_PARAMETERS, centers)?.learned, undefined);
  // Inside suggestRoutes the stop says so.
  const result = suggestRoutes(store, [a, b], NOW, DEFAULT_SUGGESTION_PARAMETERS, undefined, centers);
  assert.equal(result.suggestions[0].stops.find(stop => stop.reason)?.learned, true);
});

test("o motivo diz quando o vizinho vem do centro aprendido", () => {
  assert.equal(reasonText({ id: "x", reason: "neighbor", with: "12", meters: 1200, learned: true, lateSeconds: 0 }),
    "Bairro vizinho de #12 (centros a 1,2 km)");
  assert.equal(reasonText({ id: "x", reason: "neighbor", with: "12", meters: 800, lateSeconds: 0 }), "Bairro vizinho de #12 (800 m)");
  assert.equal(splitText({ from: "23", soonerSeconds: 12 * 60 }),
    "Dividida da rota de #23 para nenhum motoboy ficar parado · um pedido chega até 12 min antes");
  assert.equal(splitText({ from: "23", soonerSeconds: 20 }), "Dividida da rota de #23 para nenhum motoboy ficar parado");
});

test("aviso de motoboy livre: aparece com pedidos esperando e some com 'agora não' até chegar pedido novo", () => {
  const courier = { id: "s-bruno", name: "Bruno Alves" };
  assert.deepEqual(freeCourierNotice(courier, 3, {}), { courierId: "s-bruno", name: "Bruno Alves", waiting: 3 });
  assert.equal(freeCourierNotice(undefined, 3, {}), null, "nobody free");
  assert.equal(freeCourierNotice(courier, 0, {}), null, "nothing waiting");
  assert.equal(freeCourierNotice(courier, 3, { "s-bruno": 3 }), null, "dismissed with these orders");
  assert.equal(freeCourierNotice(courier, 2, { "s-bruno": 3 }), null, "fewer orders: still dismissed");
  assert.deepEqual(freeCourierNotice(courier, 4, { "s-bruno": 3 })?.waiting, 4, "a new order brings it back");
  assert.deepEqual(freeCourierNotice({ id: "s-dani", name: "Dani" }, 3, { "s-bruno": 3 })?.name, "Dani", "another courier");
});
