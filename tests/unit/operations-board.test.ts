import { test } from "node:test";
import assert from "node:assert/strict";
import { boardToState, initials, parseBoard } from "../../features/operations/live/board.ts";
import { errorMessage, rpcFor } from "../../features/operations/live/commands.ts";
import { availableCouriers, courierLabel } from "../../features/operations/model.ts";

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
    address: "Rua C, 5", neighborhood: "Vila", complement: "", notes: "", orderedAt: now, promisedMinutes: 30,
    payment: { method: "CASH", amountDueCents: 5290, changeForCents: 10000 } } },
  restaurant, live, "req-1"), { fn: "create_order", args: { p_restaurant_id: restaurant, p_request_id: "req-1",
    p_customer_name: "Eva", p_customer_phone: "+5511911112222", p_delivery_address: "Rua C, 5", p_neighborhood: "Vila",
    p_complement: null, p_reference: null, p_notes: null, p_ordered_at: "2026-11-13T22:00:00.000Z", p_promised_minutes: 30,
    p_payment_method: "CASH", p_amount_due_cents: 5290, p_change_for_cents: 10000 } });
  // A printed order goes by its code in the store's system, not by a request id.
  assert.deepEqual(rpcFor({ type: "add", now, order: { reference: "5127", customer: "Eva", phone: "(11) 91111-2222",
    address: "Rua C, 5", neighborhood: "Vila", complement: "", notes: "", orderedAt: now, promisedMinutes: 30,
    origin: { source: "PRINTER", app: null, externalId: "5127 · 13/11/2026" } } }, restaurant, live, "req-1"),
  { fn: "import_order", args: { p_restaurant_id: restaurant, p_source: "PRINTER", p_external_id: "5127 · 13/11/2026",
    p_source_app: null, p_customer_contact: null, p_customer_name: "Eva", p_customer_phone: "+5511911112222", p_delivery_address: "Rua C, 5",
    p_neighborhood: "Vila", p_complement: null, p_reference: "5127", p_notes: null, p_ordered_at: "2026-11-13T22:00:00.000Z",
    p_promised_minutes: 30, p_payment_method: null, p_amount_due_cents: null, p_change_for_cents: null } });
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
  assert.deepEqual(rpcFor({ type: "default-promise", minutes: 30 }, restaurant, live, "x"),
    { fn: "set_default_promise", args: { p_restaurant_id: restaurant, p_minutes: 30 } });
  assert.equal(rpcFor({ type: "deadline", orderId: "d1", orderedAt: now, minutes: 30 }, restaurant, live, "x"), null);
});

test("erros do banco viram frases para o balcão", () => {
  assert.match(errorMessage({ message: "RPM_ROUTE_STALE" }), /mudou em outro aparelho/);
  assert.match(errorMessage({ message: "RPM_ISSUE_CLOSED" }), /já foi resolvida/);
  assert.match(errorMessage({ message: "something else" }), /Confira a conexão/);
  assert.match(errorMessage(null), /Confira a conexão/);
});

test("o pagamento de cada pedido chega do quadro; o ilegível fica como não informado", () => {
  const withPayments = parseBoard({ ...board, orderPayments: [
    { deliveryId: "d1", method: "CARD", amountDueCents: 4500, changeForCents: null },
    { deliveryId: "d2", method: "CARD", amountDueCents: null, changeForCents: null },
  ] });
  assert.ok(withPayments);
  const state = boardToState(withPayments, { now });
  assert.deepEqual(state.state.orders.find(o => o.id === "d1")?.payment, { method: "CARD", amountDueCents: 4500 });
  assert.equal(state.state.orders.find(o => o.id === "d2")?.payment, undefined, "a card without the amount is never guessed");
  assert.equal(boardToState(parseBoard(board)!, { now }).state.orders[0].payment, undefined, "older server: none");
  assert.match(errorMessage({ message: "RPM_ORDER_FIELDS" }), /pagamento/);
});

test("pedido do iFood: sem celular no quadro, com o contato do app; só a importação manda o contato", () => {
  const withContact = parseBoard({ ...board,
    orders: board.orders.map((o, index) => index === 0 ? { ...o, phone: null } : o),
    customerContacts: [{ deliveryId: "d1", contact: "0800 718 2283 · ID 12345678" }] });
  assert.ok(withContact, "an order without a mobile is still a valid board");
  const order = boardToState(withContact, { now }).state.orders.find(o => o.id === "d1")!;
  assert.equal(order.phone, "");
  assert.equal(order.contact, "0800 718 2283 · ID 12345678");
  const live = boardToState(parseBoard(board)!, { now });
  const base = { reference: "4821", customer: "João", phone: "", address: "Rua C, 5", neighborhood: "Centro", complement: "",
    notes: "", orderedAt: now, promisedMinutes: 30, contact: "0800 718 2283 · ID 12345678", payment: { method: "PAID" as const } };
  const imported = rpcFor({ type: "add", now, order: { ...base, origin: { source: "PRINTER", app: "iFood", externalId: "4821 · 13/11/2026" } } },
    "rest-1", live, "req-9");
  assert.equal(imported?.fn, "import_order");
  assert.equal(imported?.args.p_customer_phone, null);
  assert.equal(imported?.args.p_customer_contact, "0800 718 2283 · ID 12345678");
  assert.equal(rpcFor({ type: "add", now, order: base }, "rest-1", live, "req-9")?.args.p_customer_contact, undefined,
    "an order typed in the panel never goes without the mobile");
});

test("motoboy aprovado que ainda não chegou fica \"A caminho\", fora da fila, com \"Chegou\" no painel", () => {
  const withArrivals = {
    ...board,
    couriers: [...board.couriers, { shiftId: "s3", name: "Caio", status: "AVAILABLE", linkActive: true,
      requestedAt: "2026-11-13T21:50:00Z", availableSince: "2026-11-13T21:55:00Z" }],
    shiftArrivals: [{ shiftId: "s1", arrivedAt: "2026-11-13T21:40:30Z" }, { shiftId: "s2", arrivedAt: null },
      { shiftId: "s3", arrivedAt: null }],
  };
  assert.ok(parseBoard(withArrivals));
  assert.equal(parseBoard({ ...withArrivals, shiftArrivals: [{ shiftId: "s3", arrivedAt: "ontem" }] }), null);
  const live = boardToState(parseBoard(withArrivals)!, { now });
  const caio = live.state.couriers.find(c => c.id === "s3")!;
  assert.equal(caio.arriving, true);
  assert.equal(courierLabel(live.state, caio), "A caminho");
  assert.ok(!availableCouriers(live.state).some(c => c.id === "s3"));
  assert.equal(live.state.couriers.find(c => c.id === "s2")!.arriving, undefined, "a pending shift is never on the way");
  assert.equal(boardToState(parseBoard(board)!, { now }).state.couriers.find(c => c.id === "s1")!.arriving, undefined,
    "an older database without the list: everybody approved is in line, as before");
  assert.deepEqual(rpcFor({ type: "mark-arrived", shiftId: "s3" }, "rest-1", live, "req"),
    { fn: "mark_shift_arrived", args: { p_restaurant_id: "rest-1", p_shift_id: "s3" } });
});
