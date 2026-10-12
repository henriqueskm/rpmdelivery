import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../../features/operations/fixtures.ts";
import { operationsReducer, type DemoState } from "../../features/operations/model.ts";
import { deadlineAt, deadlineInfo, mostUrgentOrder, DEMO_EPOCH, MINUTE } from "../../features/operations/deadlines.ts";

const routeId = "route-42";
function release(state: DemoState) {
  return operationsReducer(state, { type: "release", routeId, expectedOrderIds: state.routes.find(r => r.id === routeId)!.orderIds, now: DEMO_EPOCH });
}
function edit(state: DemoState, ids: string[]) {
  return operationsReducer(state, { type: "assign", courierId: "marcos", editingId: routeId, ids });
}
const start = { type: "start", routeId, actorId: "marcos" } as const;

test("limite usa horário original, não cadastro/atribuição; fronteiras próximo e vencido são explícitas", () => {
  const order = { ...createDemoState().orders[0], orderedAt: DEMO_EPOCH - 30 * MINUTE, createdAt: DEMO_EPOCH - 5 * MINUTE, promisedMinutes: 60 };
  assert.equal(deadlineAt(order), DEMO_EPOCH + 30 * MINUTE);
  assert.equal(deadlineInfo(order, DEMO_EPOCH).minutes, 30);
  assert.equal(deadlineInfo(order, DEMO_EPOCH).remaining, 0.5);
  assert.equal(deadlineInfo(order, DEMO_EPOCH).tone, "green");
  assert.equal(deadlineInfo(order, deadlineAt(order) - 8 * MINUTE).tone, "orange");
  assert.equal(deadlineInfo(order, deadlineAt(order) - 5 * MINUTE).tone, "red");
  assert.equal(deadlineInfo(order, deadlineAt(order) - 2 * MINUTE).label, "Crítico · 2m");
  assert.equal(deadlineInfo(order, deadlineAt(order) + MINUTE).remaining, 0);
  assert.equal(deadlineInfo(order, order.orderedAt - MINUTE).remaining, 1);
  assert.equal(deadlineInfo(order, deadlineAt(order) - 10 * MINUTE).status, "near");
  assert.equal(deadlineInfo(order, deadlineAt(order)).status, "overdue");
  assert.equal(deadlineInfo(order, deadlineAt(order) + 1).label, "Vencido agora");
  assert.equal(deadlineInfo(order, deadlineAt(order) + 2 * MINUTE).minutes, 2);
});

test("prazo padrão vale só para novos pedidos; override e horário anterior preservam limite próprio", () => {
  const original = createDemoState();
  const state = operationsReducer(original, { type: "default-promise", minutes: 90 });
  assert.equal(state.defaultPromiseMinutes, 90);
  assert.deepEqual(state.orders, original.orders);
  const next = operationsReducer(state, { type: "add", now: DEMO_EPOCH, order: {
    reference: "", customer: "Cliente fictício", phone: "11900000000", address: "Rua, 1", neighborhood: "Centro", complement: "", notes: "",
    orderedAt: DEMO_EPOCH - 20 * MINUTE, promisedMinutes: state.defaultPromiseMinutes,
  } });
  assert.equal(next.orders[0].createdAt, DEMO_EPOCH);
  assert.equal(deadlineAt(next.orders[0]), DEMO_EPOCH + 70 * MINUTE);
  const edited = operationsReducer(next, { type: "deadline", orderId: next.orders[0].id, orderedAt: next.orders[0].orderedAt, minutes: 15 });
  assert.equal(deadlineInfo(edited.orders[0], DEMO_EPOCH).status, "overdue");
  assert.equal(edited.orders[0].createdAt, DEMO_EPOCH);
});

test("promessas inválidas, datas inválidas/futuras e edição de pedido entregue são rejeitadas", () => {
  const state = createDemoState();
  const order = state.orders[0];
  for (const minutes of [0, -1, 241, 1.5, NaN, Infinity]) {
    assert.equal(operationsReducer(state, { type: "default-promise", minutes }), state);
    assert.equal(operationsReducer(state, { type: "deadline", orderId: order.id, orderedAt: order.orderedAt, minutes }), state);
    assert.equal(operationsReducer(state, { type: "add", now: DEMO_EPOCH, order: { ...order, promisedMinutes: minutes } }), state);
  }
  for (const orderedAt of [NaN, Infinity, 0, -1, order.createdAt + 1])
    assert.equal(operationsReducer(state, { type: "deadline", orderId: order.id, orderedAt, minutes: 60 }), state);
  assert.equal(operationsReducer(state, { type: "add", now: DEMO_EPOCH, order: { ...order, orderedAt: DEMO_EPOCH + MINUTE } }), state);
  assert.equal(operationsReducer(state, { type: "deadline", orderId: "demo-order-1038", orderedAt: DEMO_EPOCH - 20 * MINUTE, minutes: 60 }), state);
  for (const minutes of [1, 240]) assert.equal(operationsReducer(state, { type: "default-promise", minutes }).defaultPromiseMinutes, minutes);
});

test("pedido mais urgente não reordena rota e ignora entregas já concluídas", () => {
  const state = createDemoState();
  const route = { ...state.routes[0], orderIds: [state.orders[0].id, state.orders[1].id, state.orders[2].id, "demo-order-1038"] };
  const sequence = [...route.orderIds];
  assert.equal(mostUrgentOrder(state, route)?.id, state.orders[2].id);
  assert.deepEqual(route.orderIds, sequence);
  assert.equal(mostUrgentOrder(state, { ...route, orderIds: [] }), undefined);
  assert.equal(mostUrgentOrder(state, { ...route, orderIds: ["demo-order-1038"] }), undefined);
});

test("início bloqueado no domínio até liberação; liberar todos mantém PREPARING, reserva e sequência", () => {
  const state = createDemoState();
  assert.equal(operationsReducer(state, start), state);
  const next = release(state);
  assert.equal(next.routes[0].pickupReleasedAt, DEMO_EPOCH);
  assert.equal(next.routes[0].status, "PREPARING");
  assert.deepEqual(next.routes[0].orderIds, state.routes[0].orderIds);
  assert.equal(next.couriers.find(c => c.id === "marcos")?.shift, "AVAILABLE");
  assert.deepEqual(next.orders, state.orders);
  assert.equal(operationsReducer(next, { ...start, actorId: "joao" }), next);
  for (const pickupReleasedAt of [0, -1, NaN, Infinity]) {
    const invalid = { ...next, routes: next.routes.map(r => r.id === routeId ? { ...r, pickupReleasedAt } : r) };
    assert.equal(operationsReducer(invalid, start), invalid);
  }
  assert.equal(release(next), next);
  const started = operationsReducer(next, start);
  assert.equal(started.routes[0].status, "ON_ROUTE");
  assert.deepEqual(started.routes[0].orderIds, next.routes[0].orderIds);
  assert.equal(release(started), started);
  assert.equal(edit(started, [...started.routes[0].orderIds].reverse()), started);
});

test("reordenar preserva liberação; adicionar/remover/substituir invalida mesmo com mesma quantidade", () => {
  const released = release(createDemoState());
  const originalIds = released.routes[0].orderIds;
  const reordered = edit(released, [...originalIds].reverse());
  assert.equal(reordered.routes[0].pickupReleasedAt, DEMO_EPOCH);
  assert.notEqual(operationsReducer(reordered, start), reordered);
  for (const ids of [[...originalIds, "demo-order-1048"], [originalIds[0]], [originalIds[0], "demo-order-1048"]]) {
    const next = edit(released, ids);
    assert.equal(next.routes[0].pickupReleasedAt, null);
    assert.equal(operationsReducer(next, start), next);
    const confirmed = release(next);
    assert.equal(confirmed.routes[0].pickupReleasedAt, DEMO_EPOCH);
    assert.equal(operationsReducer(confirmed, start).routes[0].status, "ON_ROUTE");
  }
  const deadline = operationsReducer(released, { type: "deadline", orderId: originalIds[0], orderedAt: released.orders.find(o => o.id === originalIds[0])!.orderedAt, minutes: 30 });
  assert.equal(deadline.routes[0].pickupReleasedAt, DEMO_EPOCH);
});

test("liberação obsoleta/duplicada, pedido ausente e motoboy inválido não passam", () => {
  const original = createDemoState();
  const changed = edit(original, ["demo-order-1041", "demo-order-1048"]);
  assert.equal(operationsReducer(changed, { type: "release", routeId, expectedOrderIds: original.routes[0].orderIds, now: DEMO_EPOCH }), changed);
  assert.equal(operationsReducer(original, { type: "release", routeId, expectedOrderIds: ["demo-order-1042", "demo-order-1042"], now: DEMO_EPOCH }), original);
  const missing = { ...original, orders: original.orders.filter(o => o.id !== original.routes[0].orderIds[0]) };
  assert.equal(release(missing), missing);
  const inactive = { ...original, couriers: original.couriers.map(c => c.id === "marcos" ? { ...c, activeLink: false } : c) };
  assert.equal(release(inactive), inactive);
  const corrupted = { ...release(original), orders: missing.orders };
  assert.equal(operationsReducer(corrupted, start), corrupted);
});
