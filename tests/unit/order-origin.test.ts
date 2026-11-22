import { test } from "node:test";
import assert from "node:assert/strict";
import { originLabel, originTitle } from "../../features/operations/order-origin.ts";
import { boardToState, parseBoard } from "../../features/operations/live/board.ts";

test("etiqueta: o nome do app, ou o caminho quando o sistema não tem nome", () => {
  assert.equal(originLabel({ source: "OPEN_DELIVERY", app: "99Food", externalId: "A1" }), "99Food");
  assert.equal(originLabel({ source: "PRINTER", app: null, externalId: "5127" }), "Impressora");
  assert.equal(originLabel({ source: "OPEN_DELIVERY", app: "  ", externalId: "A1" }), "App de delivery");
});

test("dica: de onde veio e o código no outro sistema", () => {
  assert.equal(originTitle({ source: "PRINTER", app: "Balcão", externalId: "5127" }), "Veio da impressora (Balcão) · código 5127");
  assert.equal(originTitle({ source: "OPEN_DELIVERY", app: null, externalId: "XY-9" }), "Veio do app de delivery · código XY-9");
});

const now = Date.parse("2026-11-30T20:00:00Z");
const order = (deliveryId: string) => ({
  deliveryId, orderId: `o-${deliveryId}`, reference: deliveryId, customer: "Carla", phone: "+5511987654321",
  address: "Rua A, 10", neighborhood: "Centro", complement: null, notes: null,
  orderedAt: "2026-11-30T19:30:00Z", createdAt: "2026-11-30T19:31:00Z", promisedMinutes: 45,
  orderStatus: "OPEN", deliveryStatus: "WAITING", failedAttempts: 0,
});
const board = {
  serverNow: "2026-11-30T20:00:00Z",
  restaurant: { defaultPromiseMinutes: 45, issueTimeoutMinutes: 10 },
  couriers: [], routes: [], issues: [], orders: [order("d1"), order("d2")],
};

test("quadro: pedido importado mostra de onde veio; pedido do painel não mostra nada", () => {
  const withSources = { ...board, orderSources: [{ deliveryId: "d2", source: "PRINTER", app: "Balcão", externalId: "5127" }] };
  const orders = boardToState(parseBoard(withSources)!, { now }).state.orders;
  assert.deepEqual(orders.find(o => o.id === "d2")!.origin, { source: "PRINTER", app: "Balcão", externalId: "5127" });
  assert.equal("origin" in orders.find(o => o.id === "d1")!, false);
  // Before the import migration there is no list: nothing changes.
  assert.equal(boardToState(parseBoard(board)!, { now }).state.orders.some(o => o.origin), false);
});

test("quadro: origem estranha recusa a resposta inteira", () => {
  for (const bad of [{ source: "PANEL", app: null, externalId: "1" }, { source: "PRINTER", app: 3, externalId: "1" },
    { source: "OPEN_DELIVERY", app: null, externalId: null }])
    assert.equal(parseBoard({ ...board, orderSources: [{ deliveryId: "d2", ...bad }] }), null);
});
