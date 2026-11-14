import { test } from "node:test";
import assert from "node:assert/strict";
import { rpcFor } from "../../features/operations/live/commands.ts";
import type { NewOrder } from "../../features/operations/model.ts";

const order: NewOrder = {
  reference: "2001", customer: "Marina Teixeira", phone: "(11) 91234-5678", address: "Rua das Acácias, 55",
  neighborhood: "Vila Mariana", complement: "", notes: "", orderedAt: Date.parse("2026-11-14T15:00:00Z"), promisedMinutes: 60,
};
const board = {} as never;

test("endereço escolhido na busca leva as coordenadas para o banco", () => {
  const call = rpcFor({ type: "add", now: 0, order: { ...order,
    geocode: { latitude: -23.58, longitude: -46.64, providerId: "mapbox_test_id" } } }, "store-1", board, "req-1")!;
  assert.equal(call.fn, "create_order");
  assert.equal(call.args.p_latitude, -23.58);
  assert.equal(call.args.p_longitude, -46.64);
  assert.equal(call.args.p_address_provider, "mapbox");
  assert.equal(call.args.p_address_provider_id, "mapbox_test_id");
});

test("endereço só digitado é salvo sem coordenadas", () => {
  const call = rpcFor({ type: "add", now: 0, order }, "store-1", board, "req-1")!;
  for (const key of ["p_latitude", "p_longitude", "p_address_provider", "p_address_provider_id"])
    assert.equal(key in call.args, false, key);
  assert.equal(call.args.p_delivery_address, "Rua das Acácias, 55");
});
