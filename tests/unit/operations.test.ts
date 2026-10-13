import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../../features/operations/fixtures.ts";
import { DEMO_EPOCH } from "../../features/operations/deadlines.ts";
import {
  availableCouriers,
  courierLabel,
  operationsReducer,
} from "../../features/operations/model.ts";

test("atribuição reserva o motoboy em PREPARING sem marcar entregas em rota", () => {
  const before = createDemoState();
  const ids = before.orders.slice(0, 2).map((o) => o.id);
  const state = operationsReducer(before, {
    type: "assign",
    ids,
    courierId: "joao",
  });
  assert.equal(state.routes[0].status, "PREPARING");
  assert.equal(courierLabel(state, state.couriers[0]), "Reservado");
  assert.equal(state.couriers[0].shift, "AVAILABLE");
  assert.ok(!availableCouriers(state).some((c) => c.id === "joao"));
  assert.ok(
    state.orders
      .filter((o) => ids.includes(o.id))
      .every((o) => o.delivery === "ASSIGNED" && o.status === "OPEN"),
  );
  assert.equal(
    operationsReducer(state, {
      type: "assign",
      ids: [before.orders[2].id],
      courierId: "joao",
    }),
    state,
  );
  assert.equal(before.orders[0].delivery, "WAITING");
  assert.equal(before.routes.length, 4);
});

test("turno pendente, vínculo inativo, duplicatas e pedido ocupado bloqueiam atribuição", () => {
  const state = createDemoState();
  const id = state.orders[0].id;
  for (const courierId of ["ana", "rafa", "marcos", "inexistente"])
    assert.equal(
      operationsReducer(state, { type: "assign", ids: [id], courierId }),
      state,
    );
  const inactive = {
    ...state,
    couriers: state.couriers.map((c) =>
      c.id === "joao" ? { ...c, activeLink: false } : c,
    ),
  };
  assert.equal(
    operationsReducer(inactive, {
      type: "assign",
      ids: [id],
      courierId: "joao",
    }),
    inactive,
  );
  for (const ids of [[], [id, id], ["inexistente"], ["demo-order-1042"]])
    assert.equal(
      operationsReducer(state, { type: "assign", ids, courierId: "joao" }),
      state,
    );
});

test("edição libera pedidos removidos e reordena somente enquanto PREPARING", () => {
  const state = createDemoState();
  const edited = operationsReducer(state, {
    type: "assign",
    courierId: "marcos",
    editingId: "route-42",
    ids: ["demo-order-1041", "demo-order-1048"],
  });
  assert.deepEqual(edited.routes[0].orderIds, [
    "demo-order-1041",
    "demo-order-1048",
  ]);
  assert.equal(
    edited.orders.find((o) => o.id === "demo-order-1042")?.delivery,
    "WAITING",
  );
  assert.equal(edited.nextRoute, state.nextRoute);
  const released = operationsReducer(edited, { type: "release", routeId: "route-42", expectedOrderIds: edited.routes[0].orderIds, now: DEMO_EPOCH });
  const started = operationsReducer(released, {
    type: "start",
    routeId: "route-42",
    actorId: "marcos",
  });
  assert.equal(
    operationsReducer(started, {
      type: "assign",
      courierId: "marcos",
      editingId: "route-42",
      ids: ["demo-order-1048"],
    }),
    started,
  );
});

test("somente o ator da rota inicia; retorno confirmado devolve ao fim da fila", () => {
  let state = createDemoState();
  assert.equal(
    operationsReducer(state, {
      type: "start",
      routeId: "route-42",
      actorId: "joao",
    }),
    state,
  );
  assert.equal(
    operationsReducer(state, {
      type: "arrive",
      routeId: "route-42",
      actorId: "marcos",
    }),
    state,
  );
  state = operationsReducer(state, { type: "release", routeId: "route-42", expectedOrderIds: state.routes[0].orderIds, now: DEMO_EPOCH });
  state = operationsReducer(state, {
    type: "start",
    routeId: "route-42",
    actorId: "marcos",
  });
  assert.equal(state.routes[0].status, "ON_ROUTE");
  assert.ok(
    state.orders
      .filter((o) => state.routes[0].orderIds.includes(o.id))
      .every((o) => o.delivery === "ON_ROUTE" || o.delivery === "NEXT"),
  );
  assert.equal(operationsReducer(state, {
    type: "finish",
    routeId: "route-42",
    actorId: "marcos",
  }),state);
  for(const orderId of state.routes[0].orderIds) state=operationsReducer(state,{
    type:"delivery-complete",routeId:"route-42",orderId,actorId:"marcos",now:DEMO_EPOCH,
    commandId:`complete:${orderId}`,expectedAttempt:1,
  });
  assert.equal(state.routes[0].status, "RETURNING");
  assert.ok(!availableCouriers(state).some((c) => c.id === "marcos"));
  state = operationsReducer(state, {
    type: "arrive",
    routeId: "route-42",
    actorId: "marcos",
  });
  assert.equal(state.routes[0].status, "COMPLETED");
  assert.equal(availableCouriers(state).at(-1)?.id, "marcos");
  assert.equal(
    operationsReducer(state, {
      type: "start",
      routeId: "route-42",
      actorId: "marcos",
    }),
    state,
  );
});

test("comando legado não pula entregas ou falhas; pedido inválido não é cadastrado", () => {
  const state = createDemoState();
  assert.equal(
    operationsReducer(state, {
      type: "finish",
      routeId: "route-41",
      actorId: "rafa",
    }),
    state,
  );
  assert.equal(
    operationsReducer(state, {
      type: "add",
      now: DEMO_EPOCH,
      order: {
        reference: "",
        customer: "  ",
        phone: "",
        address: "",
        neighborhood: "",
        complement: "",
        notes: "",
        orderedAt: DEMO_EPOCH,
        promisedMinutes: 60,
      },
    }),
    state,
  );
  const next = operationsReducer(state, {
    type: "add",
    now: DEMO_EPOCH,
    order: {
      reference: "",
      customer: "Cliente fictício",
      phone: "11900000000",
      address: "Rua fictícia, 1",
      neighborhood: "Centro",
      complement: "",
      notes: "",
      orderedAt: DEMO_EPOCH,
      promisedMinutes: 60,
    },
  });
  assert.equal(next.orders[0].reference, "1049");
  assert.equal(next.orders[0].delivery, "WAITING");
});
