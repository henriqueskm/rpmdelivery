import { test } from "node:test";
import assert from "node:assert/strict";
import { boardToState, initials, parseBoard } from "../../features/operations/live/board.ts";
import { errorMessage, rpcFor } from "../../features/operations/live/commands.ts";

const now = Date.parse("2026-11-13T22:00:00Z");
const board = {
  serverNow: "2026-11-13T22:00:30Z",
  restaurant: { defaultPromiseMinutes: 45, issueTimeoutMinutes: 10 },
  couriers: [
    { shiftId: "s1", name: "Ana Paula Souza", status: "AVAILABLE", linkActive: true,
      requestedAt: "2026-11-13T21:00:00Z", availableSince: "2026-11-13T21:40:30Z" },
    { shiftId: "s2", name: "Bruno", status: "PENDING", linkActive: true,
      requestedAt: "2026-11-13T21:58:00Z", availableSince: null },
  ],
  routes: [
    { id: "r1", reference: "R-7", shiftId: "s1", status: "ON_ROUTE", compositionVersion: 3,
      pickupReleasedAt: "2026-11-13T21:45:00Z", deliveryIds: ["d1", "d2"], retryDeliveryIds: [] },
  ],
  orders: [
    { deliveryId: "d1", orderId: "o1", reference: "1048", customer: "Carla", phone: "+5511987654321",
      address: "Rua A, 10", neighborhood: "Centro", complement: null, notes: null,
      orderedAt: "2026-11-13T21:30:00Z", createdAt: "2026-11-13T21:31:00Z", promisedMinutes: 45,
      orderStatus: "DELIVERING", deliveryStatus: "ATTEMPT_FAILED", failedAttempts: 1 },
    { deliveryId: "d2", orderId: "o2", reference: "12", customer: "Davi", phone: "+5511912345678",
      address: "Rua B, 20", neighborhood: null, complement: "Ap 3", notes: "Sem cebola",
      orderedAt: "2026-11-13T21:32:00Z", createdAt: "2026-11-13T21:33:00Z", promisedMinutes: 45,
      orderStatus: "DELIVERING", deliveryStatus: "NEXT", failedAttempts: 0 },
  ],
  issues: [
    { id: "a1", deliveryId: "d1", routeId: "r1", attempt: 1, reason: "CUSTOMER_NOT_RESPONDING",
      notes: "tocou 3x", reportedAt: "2026-11-13T21:55:00Z", decisionDeadline: "2026-11-13T22:05:00Z",
      decision: null, decidedAt: null, decidedBy: null },
  ],
};

test("resposta do painel é validada inteira antes de virar tela", () => {
  assert.deepEqual(parseBoard(board), board);
  for (const bad of [null, [], { ...board, serverNow: "x" }, { ...board, orders: [{ ...board.orders[0], deliveryStatus: "LOST" }] },
    { ...board, couriers: [{ ...board.couriers[0], name: 3 }] }, { ...board, routes: [{ ...board.routes[0], deliveryIds: [1] }] },
    { ...board, issues: [{ ...board.issues[0], decision: "MAYBE" }] }, { ...board, restaurant: {} }])
    assert.equal(parseBoard(bad), null);
});

test("painel vira o estado das telas: pedidos por entrega, motoboys por turno, rotas e ocorrências", () => {
  const live = boardToState(parseBoard(board)!, { now });
  assert.equal(live.clockOffset, 30_000);
  assert.deepEqual(live.versions, { r1: 3 });
  assert.deepEqual(live.orderIds, { d1: "o1", d2: "o2" });
  const [failed, next] = live.state.orders;
  assert.equal(failed.id, "d1");
  assert.equal(failed.phone, "(11) 98765-4321");
  assert.equal(failed.neighborhood, "Centro");
  assert.equal(failed.attemptNumber, 1);
  assert.equal(next.neighborhood, "");
  assert.equal(next.complement, "Ap 3");
  assert.equal(next.attemptNumber, 1);
  assert.equal(next.orderedAt, Date.parse("2026-11-13T21:32:00Z"));
  const [ana, bruno] = live.state.couriers;
  assert.deepEqual({ ...ana }, { id: "s1", name: "Ana Paula Souza", initials: "AS", shift: "AVAILABLE",
    activeLink: true, queueOrder: 0, availableMinutes: 20 });
  assert.equal(bruno.shift, "PENDING");
  assert.equal(bruno.availableMinutes, 0);
  assert.deepEqual(live.state.routes[0], { id: "r1", reference: "R-7", courierId: "s1", orderIds: ["d1", "d2"],
    status: "ON_ROUTE", pickupReleasedAt: Date.parse("2026-11-13T21:45:00Z"), retryOrderIds: [] });
  const [issue] = live.state.issues;
  assert.equal(issue.status, "PENDING");
  assert.equal(issue.orderId, "d1");
  assert.equal(issue.courierId, "s1");
  assert.equal(issue.description, "tocou 3x");
  assert.equal(live.state.defaultPromiseMinutes, 45);
  assert.equal(live.state.issueTimeoutMinutes, 10);
});

test("ocorrência vencida aparece encerrada e o pedido voltando, mesmo antes do servidor fechar", () => {
  // Read 30 s behind the server; five minutes later the deadline has passed.
  const late = boardToState(parseBoard(board)!, { receivedAt: now, now: now + 270_000 });
  assert.equal(boardToState(parseBoard(board)!, { receivedAt: now, now: now + 269_000 }).state.issues[0].status, "PENDING");
  assert.equal(late.state.issues[0].status, "CLOSED");
  assert.equal(late.state.issues[0].resolution, "TIMEOUT");
  assert.equal(late.state.orders[0].delivery, "RETURN_TO_STORE");
  const decided = boardToState(parseBoard({ ...board, issues: [{ ...board.issues[0], decision: "RETRY",
    decidedAt: "2026-11-13T21:57:00Z", decidedBy: "u1" }] })!, { now });
  assert.deepEqual([decided.state.issues[0].status, decided.state.issues[0].resolution, decided.state.issues[0].decidedBy],
    ["CLOSED", "RETRY", "u1"]);
});

test("iniciais do motoboy", () => {
  assert.equal(initials("Ana Paula Souza"), "AS");
  assert.equal(initials("bruno"), "B");
  assert.equal(initials("  "), "?");
});

test("cada comando do painel vira a RPC certa, com a versão e a idempotência", () => {
  const live = boardToState(parseBoard(board)!, { now });
  const restaurant = "rest-1";
  assert.deepEqual(rpcFor({ type: "add", now, order: { reference: " ", customer: " Eva ", phone: "(11) 91111-2222",
    address: "Rua C, 5", neighborhood: "Vila", complement: "", notes: "", orderedAt: now, promisedMinutes: 30 } },
  restaurant, live, "req-1"), { fn: "create_order", args: { p_restaurant_id: restaurant, p_request_id: "req-1",
    p_customer_name: "Eva", p_customer_phone: "+5511911112222", p_delivery_address: "Rua C, 5", p_neighborhood: "Vila",
    p_complement: null, p_reference: null, p_notes: null, p_ordered_at: "2026-11-13T22:00:00.000Z", p_promised_minutes: 30 } });
  assert.deepEqual(rpcFor({ type: "assign", ids: ["d3"], courierId: "s1" }, restaurant, live, "req-2"),
    { fn: "create_route", args: { p_restaurant_id: restaurant, p_request_id: "req-2", p_shift_id: "s1", p_delivery_ids: ["d3"] } });
  assert.deepEqual(rpcFor({ type: "assign", ids: ["d2", "d1"], courierId: "s1", editingId: "r1" }, restaurant, live, "x"),
    { fn: "update_route_composition", args: { p_restaurant_id: restaurant, p_route_id: "r1", p_expected_version: 3, p_delivery_ids: ["d2", "d1"] } });
  assert.deepEqual(rpcFor({ type: "release", routeId: "r1", expectedOrderIds: [], now }, restaurant, live, "x"),
    { fn: "release_route_pickup", args: { p_restaurant_id: restaurant, p_route_id: "r1", p_expected_version: 3 } });
  assert.deepEqual(rpcFor({ type: "revoke-release", routeId: "r1" }, restaurant, live, "x")?.fn, "revoke_route_pickup");
  assert.deepEqual(rpcFor({ type: "issue-decide", issueId: "a1", decision: "RETURN", actorId: "", now, commandId: "" }, restaurant, live, "x"),
    { fn: "decide_delivery_failure", args: { p_restaurant_id: restaurant, p_delivery_id: "d1", p_decision: "RETURN" } });
  assert.equal(rpcFor({ type: "issue-decide", issueId: "nope", decision: "RETURN", actorId: "", now, commandId: "" }, restaurant, live, "x"), null);
  assert.deepEqual(rpcFor({ type: "delivery-cancel", routeId: "r1", orderId: "d2", actorId: "", now, commandId: "" }, restaurant, live, "x"),
    { fn: "cancel_delivery_on_route", args: { p_restaurant_id: restaurant, p_delivery_id: "d2" } });
  assert.deepEqual(rpcFor({ type: "review-shift", shiftId: "s2", approve: true }, restaurant, live, "x"),
    { fn: "review_shift", args: { p_restaurant_id: restaurant, p_shift_id: "s2", p_approve: true } });
  assert.equal(rpcFor({ type: "default-promise", minutes: 30 }, restaurant, live, "x"), null);
});

test("erros do banco viram frases para o balcão", () => {
  assert.match(errorMessage({ message: "RPM_ROUTE_STALE" }), /mudou em outro aparelho/);
  assert.match(errorMessage({ message: "RPM_ISSUE_CLOSED" }), /já foi resolvida/);
  assert.match(errorMessage({ message: "something else" }), /Confira a conexão/);
  assert.match(errorMessage(null), /Confira a conexão/);
});
