import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clockTime, distanceText, parseTracking, refreshSeconds, stopsBeforeText, trackingView,
} from "../../lib/tracking/view.ts";
import {
  MAX_GLIDE_METERS, distanceMeters, glideMs, pointAlong, pointsBounds, publicMapToken,
} from "../../lib/tracking/motion.ts";

const base = {
  status: "ON_ROUTE", restaurantName: "Pizzaria Boa", issueReason: null, stopsBefore: 2,
  courier: null, courierArea: null, distanceMeters: null, destination: null,
  startedAt: "2026-11-13T22:40:00Z", deliveredAt: null,
};
const area = { latitude: -23.015, longitude: -46.835, radiusMeters: 800, recordedAt: "2026-11-13T22:50:00Z" };

test("área aproximada e distância só passam quando bem formadas", () => {
  assert.deepEqual(parseTracking({ ...base, courierArea: area, distanceMeters: 2000 })?.courierArea, area);
  assert.equal(parseTracking({ ...base, courierArea: area, distanceMeters: 2000 })?.distanceMeters, 2000);
  for (const bad of [{ ...area, radiusMeters: 0 }, { ...area, radiusMeters: 50_000 }, { ...area, recordedAt: "" },
    { latitude: -23, longitude: -46 }, "x"])
    assert.equal(parseTracking({ ...base, courierArea: bad })?.courierArea, null);
  for (const bad of [-1, "500", Number.NaN, null]) assert.equal(parseTracking({ ...base, distanceMeters: bad })?.distanceMeters, null);
  assert.deepEqual([distanceText(null, true), distanceText(2000, true), distanceText(1500, true), distanceText(650, false)],
    [null, "a menos de 2 km de você", "a menos de 1,5 km de você", "a 650 m de você"]);
});

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

test("cada status tem título, etapa e mapa quando é o próximo ou já há área do entregador", () => {
  const parsed = parseTracking(base)!;
  const view = (status: string, extra = {}) => trackingView({ ...parsed, ...extra, status } as typeof parsed);
  assert.deepEqual([view("PREPARING").step, view("ON_ROUTE").step, view("NEXT").step, view("DELIVERED").step],
    [null, 1, 2, 3]);
  assert.equal(view("NEXT").title, "Você é o próximo!");
  assert.deepEqual(["PREPARING", "ON_ROUTE", "ATTEMPT_FAILED", "RETURNING_TO_STORE", "DELIVERED", "CANCELLED"]
    .map(status => view(status).showMap), [false, false, false, false, false, false]);
  assert.equal(view("NEXT").showMap, true);
  assert.equal(view("ON_ROUTE", { courierArea: area }).showMap, true);
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

test("mapa usa só token público", () => {
  assert.equal(publicMapToken(undefined), null);
  assert.equal(publicMapToken(""), null);
  assert.equal(publicMapToken("sk.secret"), null);
  assert.equal(publicMapToken("pk.abc"), "pk.abc");
});

test("entregador desliza entre leituras e salta quando o GPS some", () => {
  const a = { latitude: -23.55, longitude: -46.633 };
  const b = { latitude: -23.551, longitude: -46.633 };
  assert.ok(Math.abs(distanceMeters(a, b) - 111) < 1);
  assert.equal(distanceMeters(a, a), 0);
  assert.equal(glideMs(null, b, 15_000, false), 0, "primeira posição aparece direto");
  assert.equal(glideMs(a, b, 15_000, false), 15_000, "desliza até a próxima leitura");
  assert.equal(glideMs(a, b, 15_000, true), 0, "respeita movimento reduzido");
  assert.equal(glideMs(a, a, 15_000, false), 0, "parado não anima");
  const far = { latitude: a.latitude + (MAX_GLIDE_METERS + 500) / 111_000, longitude: a.longitude };
  assert.equal(glideMs(a, far, 15_000, false), 0, "lacuna de GPS salta");
  assert.deepEqual(pointAlong(a, b, 0.5), { latitude: -23.5505, longitude: -46.633 });
  assert.deepEqual(pointAlong(a, b, 2), b);
  assert.deepEqual(pointAlong(a, b, -1), a);
});

test("enquadramento cobre entregador e endereço", () => {
  assert.equal(pointsBounds([]), null);
  assert.deepEqual(pointsBounds([{ latitude: -23.56, longitude: -46.64 }, { latitude: -23.55, longitude: -46.63 }]),
    [[-46.64, -23.56], [-46.63, -23.55]]);
});
