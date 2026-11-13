import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clockTime, parseTracking, refreshSeconds, stopsBeforeText, trackingMapUrl, trackingView,
} from "../../lib/tracking/view.ts";

const base = {
  status: "ON_ROUTE", restaurantName: "Pizzaria Boa", issueReason: null, stopsBefore: 2,
  courier: null, destination: null, startedAt: "2026-11-13T22:40:00Z", deliveredAt: null,
};

test("resposta do get_tracking é validada antes de virar tela", () => {
  assert.deepEqual(parseTracking(base), { ...base, stopsBefore: 2 });
  for (const bad of [null, [], "x", { ...base, status: "LOST" }, { ...base, restaurantName: "" }])
    assert.equal(parseTracking(bad), null);
  const odd = parseTracking({ ...base, stopsBefore: -1, courier: { latitude: 91, longitude: 0, recordedAt: "x" },
    destination: { latitude: "1", longitude: 2 } });
  assert.equal(odd?.stopsBefore, null);
  assert.equal(odd?.courier, null);
  assert.equal(odd?.destination, null);
  const next = parseTracking({ ...base, status: "NEXT",
    courier: { latitude: -23.5, longitude: -46.6, recordedAt: "2026-11-13T22:50:00Z" } });
  assert.deepEqual(next?.courier, { latitude: -23.5, longitude: -46.6, recordedAt: "2026-11-13T22:50:00Z" });
  assert.equal(parseTracking({ ...base, courier: { latitude: 1, longitude: 2 } })?.courier, null);
});

test("cada status tem título, etapa e mapa só quando é o próximo", () => {
  const parsed = parseTracking(base)!;
  const view = (status: string, extra = {}) => trackingView({ ...parsed, ...extra, status } as typeof parsed);
  assert.deepEqual([view("PREPARING").step, view("ON_ROUTE").step, view("NEXT").step, view("DELIVERED").step],
    [null, 1, 2, 3]);
  assert.equal(view("NEXT").title, "Você é o próximo!");
  assert.deepEqual(["PREPARING", "ON_ROUTE", "ATTEMPT_FAILED", "RETURNING_TO_STORE", "DELIVERED", "CANCELLED"]
    .map(status => view(status).showMap), [false, false, false, false, false, false]);
  assert.equal(view("NEXT").showMap, true);
  assert.match(view("ON_ROUTE").detail, /outra entrega/);
  assert.match(view("ON_ROUTE", { stopsBefore: 0 }).detail, /já está na rua/);
  assert.match(view("ATTEMPT_FAILED", { issueReason: "ADDRESS_PROBLEM" }).detail, /endereço\. Pizzaria Boa vai decidir/);
  assert.match(view("ATTEMPT_FAILED", { issueReason: "NEW_REASON" }).detail, /imprevisto/);
  assert.match(view("RETURNING_TO_STORE").detail, /Fale com Pizzaria Boa/);
});

test("contagem de entregas antes, atualização e horário", () => {
  assert.deepEqual([null, 0, 1, 3].map(stopsBeforeText),
    [null, null, "1 entrega antes da sua", "3 entregas antes da sua"]);
  assert.deepEqual(["PREPARING", "ON_ROUTE", "NEXT", "ATTEMPT_FAILED", "RETURNING_TO_STORE", "DELIVERED", "CANCELLED"]
    .map(status => refreshSeconds(status as never)), [30, 15, 15, 15, 30, null, null]);
  assert.equal(clockTime("2026-11-13T22:40:00Z", "America/Sao_Paulo"), "19:40");
  assert.equal(clockTime("x"), null);
  assert.equal(clockTime(null), null);
});

test("mapa usa só token público e enquadra entregador e endereço", () => {
  const courier = { latitude: -23.551234, longitude: -46.633301 };
  const home = { latitude: -23.56, longitude: -46.64 };
  assert.equal(trackingMapUrl(undefined, courier, home), null);
  assert.equal(trackingMapUrl("sk.secret", courier, home), null);
  assert.equal(trackingMapUrl("pk.abc", null, null), null);
  const both = trackingMapUrl("pk.abc", courier, home)!;
  assert.match(both, /pin-l-home\+bd401b\(-46\.64000,-23\.56000\),pin-l-scooter\+1d2c24\(-46\.63330,-23\.55123\)\/auto\//);
  assert.match(both, /access_token=pk\.abc&padding=60$/);
  const homeOnly = trackingMapUrl("pk.abc", null, home)!;
  assert.match(homeOnly, /\(-46\.64000,-23\.56000\)\/-46\.64000,-23\.56000,15\/640x320@2x/);
  assert.doesNotMatch(homeOnly, /padding/);
});
