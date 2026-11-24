import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedRequest, isOrderLike, PANEL_ORIGINS, parsePrintedOrders, printedExternalId }
  from "../../lib/printing/printer-inbox.ts";
import { printedSummary, printedToIncoming } from "../../features/operations/live/printed-order.ts";

const received = new Date(2026, 10, 22, 20, 54);

test("código do pedido impresso: número com o dia, ou a impressão digital do cupom", () => {
  assert.equal(printedExternalId("5127", received, "ab".repeat(32)), "5127 · 22/11/2026");
  assert.equal(printedExternalId(undefined, received, "0123456789abcdef"), "cupom 0123456789ab");
  assert.equal(printedExternalId("5127", new Date(2026, 0, 3), "x"), "5127 · 03/01/2026");
});

test("só vira pedido o cupom com nome, WhatsApp ou endereço", () => {
  assert.equal(isOrderLike(["customer"]), true);
  assert.equal(isOrderLike(["phone"]), true);
  assert.equal(isOrderLike(["reference", "notes", "neighborhood"]), false);
  assert.equal(isOrderLike([]), false);
});

test("o painel lê a lista do programa e deixa de fora o que vier errado", () => {
  const good = { id: "a1", receivedAt: received.toISOString(), externalId: "1 · 22/11/2026", app: " Balcão ",
    order: { customer: "Maria Souza", phone: "11912345678", address: "Rua das Flores, 100", total: "R$ 10" }, found: [] };
  const orders = parsePrintedOrders({ orders: [
    good,
    { ...good, id: "bad id with spaces" },
    { ...good, id: "a2", externalId: "" },
    { ...good, id: "a3", externalId: "x".repeat(81) },
    { ...good, id: "a4", receivedAt: "ontem" },
    { ...good, id: "a5", order: { notes: "só observação" } },
    null,
  ] });
  assert.equal(orders.length, 1);
  assert.deepEqual(orders[0], { id: "a1", receivedAt: good.receivedAt, externalId: "1 · 22/11/2026", app: "Balcão",
    order: { customer: "Maria Souza", phone: "11912345678", address: "Rua das Flores, 100" },
    found: ["customer", "phone", "address"] });
  assert.deepEqual(parsePrintedOrders(null), []);
  assert.deepEqual(parsePrintedOrders({ orders: "x" }), []);
});

test("o programa só atende o painel, no próprio endereço", () => {
  const port = 9180;
  const panel = { host: "127.0.0.1:9180", origin: "http://localhost:3000", panel: "1" };
  assert.equal(allowedRequest(panel, port, PANEL_ORIGINS), true);
  assert.equal(allowedRequest({ ...panel, origin: "https://rpmdelivery.vercel.app" }, port, PANEL_ORIGINS), true);
  assert.equal(allowedRequest({ ...panel, host: "localhost:9180" }, port, PANEL_ORIGINS), true);
  assert.equal(allowedRequest({ ...panel, origin: undefined }, port, PANEL_ORIGINS), true, "a local tool, without a browser");
  assert.equal(allowedRequest({ ...panel, origin: "https://site-qualquer.example" }, port, PANEL_ORIGINS), false);
  assert.equal(allowedRequest({ ...panel, host: "evil.example:9180" }, port, PANEL_ORIGINS), false, "DNS rebinding");
  assert.equal(allowedRequest({ ...panel, panel: undefined }, port, PANEL_ORIGINS), false);
  assert.equal(allowedRequest({ ...panel, host: undefined }, port, PANEL_ORIGINS), false);
});

test("pedido impresso abre o formulário preenchido, com a origem impressora", () => {
  const [item] = parsePrintedOrders({ orders: [{ id: "a1", receivedAt: received.toISOString(), externalId: "1 · 22/11/2026",
    app: null, order: { customer: "Maria Souza", phone: "11912345678", address: "Rua das Flores, 100", reference: "1" } }] });
  const incoming = printedToIncoming(item);
  assert.deepEqual(incoming.origin, { source: "PRINTER", app: null, externalId: "1 · 22/11/2026" });
  assert.deepEqual(incoming.values, { orderedAt: received.getTime(), customer: "Maria Souza", address: "Rua das Flores, 100",
    reference: "1", phone: "(11) 91234-5678", searchAddress: true });
  assert.equal(incoming.filled,
    "Lido do cupom: nome, WhatsApp, endereço e nº do pedido. Escolha o endereço na lista para confirmar no mapa."
    + " O cupom não diz o pagamento: marque se está pago ou quanto cobrar.");
  assert.equal(printedSummary(item), "Maria Souza · #1");

  const [bare] = parsePrintedOrders({ orders: [{ id: "a2", receivedAt: received.toISOString(), externalId: "cupom 1",
    order: { customer: "João" } }] });
  assert.equal(printedToIncoming(bare).filled,
    "Lido do cupom: nome. O cupom não tem endereço: digite o do cliente. O cupom não tem celular: peça o WhatsApp do cliente."
    + " O cupom não diz o pagamento: marque se está pago ou quanto cobrar.");
  assert.equal(printedSummary(bare), "João");

  // iFood hides the mobile: the form keeps its 0800 contact and does not ask for the WhatsApp.
  const [ifood] = parsePrintedOrders({ orders: [{ id: "a5", receivedAt: received.toISOString(), externalId: "4821 · 22/11/2026",
    app: "iFood", order: { customer: "João", contact: "0800 718 2283 · ID 12345678" } }] });
  assert.equal(printedToIncoming(ifood).values.contact, "0800 718 2283 · ID 12345678");
  assert.equal(printedToIncoming(ifood).values.phone, undefined);
  assert.match(printedToIncoming(ifood).filled, /Lido do cupom: nome e contato do app\. .*O app esconde o celular: fica o contato dele, e o WhatsApp é opcional\./);

  // The payment the receipt says goes into the form; an incomplete one asks for the rest.
  const [paid] = parsePrintedOrders({ orders: [{ id: "a3", receivedAt: received.toISOString(), externalId: "2 · 22/11/2026",
    order: { customer: "Bia" }, payment: { method: "CASH", amountDueCents: 5290, changeForCents: 10000 } }] });
  assert.deepEqual(printedToIncoming(paid).values.payment, { method: "CASH", amountDueCents: 5290, changeForCents: 10000 });
  assert.match(printedToIncoming(paid).filled, /Pagamento: Cobrar R\$ 52,90 em dinheiro · troco para R\$ 100,00\.$/);
  const [half] = parsePrintedOrders({ orders: [{ id: "a4", receivedAt: received.toISOString(), externalId: "3 · 22/11/2026",
    order: { customer: "Rui" }, payment: { method: "CARD", amountDueCents: "45" } }] });
  assert.match(printedToIncoming(half).filled, /Complete o pagamento \(lido: Cartão · valor não reconhecido\)\.$/);
});
