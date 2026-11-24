import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyQueue, placeReceipt, queueToSave, restoreQueue, sameCustomer, takeOrder }
  from "../../lib/printing/printer-queue.ts";
import { parsePrintedOrders, QUEUE_LIMIT } from "../../lib/printing/printer-inbox.ts";
import type { PastedOrder } from "../../features/operations/paste-order.ts";

const at = new Date(2026, 10, 23, 19, 30);
let ids = 0;
const receipt = (order: PastedOrder, receivedAt = at, fingerprint = "f".repeat(64)) => ({
  id: `job-${++ids}`, receivedAt, fingerprint, app: "Balcão", order,
  found: (Object.keys(order) as (keyof PastedOrder)[]),
});

test("mesmo cliente: celular decide; sem celular, o nome que cabe no outro", () => {
  assert.equal(sameCustomer({ phone: "11912345678" }, { phone: "11912345678", customer: "Outro" }), true);
  assert.equal(sameCustomer({ phone: "11912345678" }, { phone: "11987654321" }), false);
  assert.equal(sameCustomer({ customer: "Lucas" }, { customer: "lucas  Mendes" }), true, "a wrapped line can be missing");
  assert.equal(sameCustomer({ customer: "Lucas Mendes" }, { customer: "Luana Mendes" }), false);
  assert.equal(sameCustomer({ customer: "José" }, { customer: "Jose" }), true, "accents");
  assert.equal(sameCustomer({}, { customer: "Bia" }), true, "nothing to compare: a reprint");
});

test("pico: o 7 do iFood e o 7 do site no mesmo dia são dois pedidos; a segunda via continua um só", () => {
  const queue = emptyQueue();
  const ifood = placeReceipt(queue, receipt({ reference: "7", customer: "Ana", phone: "11912340001" }));
  const site = placeReceipt(queue, receipt({ reference: "7", customer: "Outra Pessoa", phone: "11912340002" }));
  assert.deepEqual([ifood.externalId, site.externalId], ["7 · 23/11/2026", "7 · 23/11/2026 · 2"]);
  assert.equal(site.reprint, false);
  // The kitchen copy of iFood's 7 (no phone on it) is a reprint: it replaces the copy still waiting,
  // and what it lacks (the phone, the address, the payment) still comes from that copy.
  queue.inbox[0].order.address = "Rua A, 10";
  queue.inbox[0].payment = { method: "PAID" };
  const copy = placeReceipt(queue, receipt({ reference: "7", customer: "Ana", notes: "sem cebola" }));
  assert.deepEqual([copy.externalId, copy.reprint], ["7 · 23/11/2026", true]);
  assert.deepEqual(queue.inbox.map(item => item.order.customer), ["Outra Pessoa", "Ana"]);
  assert.deepEqual(queue.inbox[1].order, { reference: "7", customer: "Ana", phone: "11912340001", address: "Rua A, 10", notes: "sem cebola" });
  assert.deepEqual(queue.inbox[1].found, ["customer", "phone", "address", "reference", "notes"]);
  assert.deepEqual(queue.inbox[1].payment, { method: "PAID" });
  // A later copy whose address has no house number never replaces one that has it.
  placeReceipt(queue, receipt({ reference: "7", customer: "Ana", address: "Entrega rápida" }));
  assert.equal(queue.inbox[1].order.address, "Rua A, 10");
  // A reprint with a corrected address (the store fixed it in its system) does replace it.
  placeReceipt(queue, receipt({ reference: "7", customer: "Ana", address: "Rua B, 22" }));
  assert.equal(queue.inbox[1].order.address, "Rua B, 22");
  // After the panel took it, a reprint keeps its code: import_order answers with the order already saved.
  takeOrder(queue, queue.inbox[1].id);
  assert.equal(placeReceipt(queue, receipt({ reference: "7", phone: "11912340001" })).externalId, "7 · 23/11/2026");
  // A third 7 the same day, and tomorrow's 7, are new orders.
  assert.equal(placeReceipt(queue, receipt({ reference: "7", phone: "11912340003" })).externalId, "7 · 23/11/2026 · 3");
  assert.equal(placeReceipt(queue, receipt({ reference: "7", phone: "11912340002" }, new Date(2026, 10, 24, 11))).externalId,
    "7 · 24/11/2026");
});

test("sem número: cupom idêntico é segunda via, cupom diferente é outro pedido", () => {
  const queue = emptyQueue();
  const first = placeReceipt(queue, receipt({ customer: "Bia" }, at, "a".repeat(64)));
  const again = placeReceipt(queue, receipt({ customer: "Bia" }, at, "a".repeat(64)));
  const other = placeReceipt(queue, receipt({ customer: "Caio" }, at, "b".repeat(64)));
  assert.equal(again.externalId, first.externalId);
  assert.notEqual(other.externalId, first.externalId);
  assert.equal(queue.inbox.length, 2);
});

test("rajada: 500 pedidos esperando cabem; só depois disso o mais antigo sai, e é avisado", () => {
  const queue = emptyQueue();
  for (let n = 1; n <= QUEUE_LIMIT; n++)
    assert.deepEqual(placeReceipt(queue, receipt({ reference: String(n), phone: "11912340001" })).dropped, []);
  assert.equal(queue.inbox.length, QUEUE_LIMIT);
  const over = placeReceipt(queue, receipt({ reference: "501", phone: "11912340001" }));
  assert.deepEqual(over.dropped.map(item => item.externalId), ["1 · 23/11/2026"]);
  // The panel reads all of them.
  assert.equal(parsePrintedOrders({ orders: queue.inbox }).length, QUEUE_LIMIT);
});

test("fila gravada volta ao abrir o programa: só as últimas 24 horas, e nada malformado", () => {
  const queue = emptyQueue();
  placeReceipt(queue, receipt({ reference: "30", customer: "Maria Teste", phone: "11916178357", address: "Rua A, 1" }));
  placeReceipt(queue, receipt({ reference: "29", customer: "Velho", address: "Rua B, 2" }, new Date(2026, 10, 22, 12)));
  const file = JSON.parse(JSON.stringify(queueToSave(queue, at)));
  file.inbox.push({ id: "../x", receivedAt: "ontem", order: {} });
  file.seen.push({ externalId: 5, base: "x" });
  const restored = restoreQueue(file, new Date(2026, 10, 23, 21));
  assert.deepEqual(restored.inbox.map(item => item.order.customer), ["Maria Teste"], "yesterday's order is not offered again");
  assert.equal(restored.seen.length, 2, "both codes are still known, for reprints");
  // A reprint after reopening keeps the code; another customer with the same number gets a new one.
  assert.equal(placeReceipt(restored, receipt({ reference: "30", phone: "11916178357" })).reprint, true);
  assert.equal(placeReceipt(restored, receipt({ reference: "30", phone: "11900000000" })).externalId, "30 · 23/11/2026 · 2");
  // Codes older than two days are forgotten; a missing or broken file is an empty queue.
  assert.equal(queueToSave(restored, new Date(2026, 10, 26)).seen.length, 0);
  assert.deepEqual(restoreQueue(null, at), emptyQueue());
  assert.deepEqual(restoreQueue({ inbox: "x", seen: 3 }, at), emptyQueue());
});
