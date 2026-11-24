import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatMoney, parseMoney, paymentArgs, paymentText, readPayment, readPaymentJson, validPayment,
} from "../../features/operations/payment.ts";

test("valores em reais", () => {
  assert.equal(parseMoney("52,90"), 5290);
  assert.equal(parseMoney("R$ 1.234,50"), 123450);
  assert.equal(parseMoney("100"), 10000);
  assert.equal(parseMoney("52.90"), 5290);
  assert.equal(parseMoney("52,9"), 5290);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney("52,"), null);
  assert.equal(formatMoney(5290), "R$ 52,90");
  assert.equal(formatMoney(123450), "R$ 1.234,50");
  assert.equal(formatMoney(5), "R$ 0,05");
});

test("o que pode ser salvo: as mesmas regras do banco", () => {
  assert.ok(validPayment({ method: "PAID" }));
  assert.ok(validPayment({ method: "CARD", amountDueCents: 4500 }));
  assert.ok(validPayment({ method: "CASH", amountDueCents: 5290, changeForCents: 10000 }));
  assert.equal(validPayment({ method: "CARD" }), false, "card without the amount");
  assert.equal(validPayment({ method: "PAID", amountDueCents: 100 }), false);
  assert.equal(validPayment({ method: "CARD", amountDueCents: 4500, changeForCents: 5000 }), false, "change only for cash");
  assert.equal(validPayment({ method: "CASH", amountDueCents: 5000, changeForCents: 5000 }), false, "change above the amount");
  assert.equal(validPayment({ amountDueCents: 5000 }), false);
  assert.equal(validPayment(undefined), false);
});

test("o que o painel e o motoboy leem", () => {
  assert.equal(paymentText({ method: "PAID" }), "Já pago");
  assert.equal(paymentText({ method: "CARD", amountDueCents: 4500 }), "Cobrar R$ 45,00 no cartão");
  assert.equal(paymentText({ method: "PIX", amountDueCents: 3000 }), "Cobrar R$ 30,00 no Pix");
  assert.equal(paymentText({ method: "CASH", amountDueCents: 5290, changeForCents: 10000 }),
    "Cobrar R$ 52,90 em dinheiro · troco para R$ 100,00");
  assert.equal(paymentText(undefined), "Pagamento não informado");
  assert.deepEqual(paymentArgs({ method: "CASH", amountDueCents: 5290, changeForCents: 10000 }),
    { p_payment_method: "CASH", p_amount_due_cents: 5290, p_change_for_cents: 10000 });
  assert.deepEqual(paymentArgs(undefined), { p_payment_method: null, p_amount_due_cents: null, p_change_for_cents: null });
});

test("JSON do quadro e do programa: o malformado fica de fora", () => {
  assert.deepEqual(readPaymentJson({ method: "CARD", amountDueCents: 4500, changeForCents: null }), { method: "CARD", amountDueCents: 4500 });
  assert.deepEqual(readPaymentJson({ method: "BOLETO", amountDueCents: -3 }), undefined);
  assert.deepEqual(readPaymentJson({ amountDueCents: 12.5 }), undefined);
  assert.equal(readPaymentJson("PAID"), undefined);
});

test("cupons: pago, cartão, Pix e dinheiro com troco", () => {
  assert.deepEqual(readPayment("2x X-Bacon R$ 58,00\nTaxa de entrega R$ 7,00\nTOTAL R$ 79,00\nPagamento: cartão na entrega"),
    { method: "CARD", amountDueCents: 7900 });
  assert.deepEqual(readPayment("Total: R$ 45,90\nPAGO ONLINE - Crédito\nNão cobrar do cliente"), { method: "PAID" });
  assert.deepEqual(readPayment("Pedido pago pelo app\nTotal R$ 30,00"), { method: "PAID" });
  assert.deepEqual(readPayment("Total: R$ 30,00\nForma de pagamento: Pix na entrega"), { method: "PIX", amountDueCents: 3000 });
  assert.deepEqual(readPayment("Subtotal R$ 40,00\nTotal: R$ 52,90\nPagamento: Dinheiro\nTroco para: R$ 100,00"),
    { method: "CASH", amountDueCents: 5290, changeForCents: 10000 });
  assert.deepEqual(readPayment("Total: R$ 52,90\nPagamento: Dinheiro\nValor pago: R$ 100,00\nTroco: R$ 47,10"),
    { method: "CASH", amountDueCents: 5290, changeForCents: 10000 }, "the cash handed over is not 'already paid'");
  assert.deepEqual(readPayment("Total: R$ 52,90\nPagamento: Dinheiro\nTroco: R$ 47,10"),
    { method: "CASH", amountDueCents: 5290, changeForCents: 10000 }, "the change itself gives the bill");
  assert.deepEqual(readPayment("Total: R$ 52,90\nDinheiro - sem troco"), { method: "CASH", amountDueCents: 5290 });
  assert.deepEqual(readPayment("Cobrar do cliente: R$ 61,90\nTotal do pedido R$ 61,90\nCartão de débito"),
    { method: "CARD", amountDueCents: 6190 });
});

test("cupom com as opções marcadas: vale só a marcada [X]", () => {
  // The iFood receipt model prints every option and ticks one (fictional data).
  const receipt = (paid: boolean) => [
    "TOTAL A COBRAR / PAGO:                 R$ 63,88", "------", "FORMA DE PAGAMENTO", "------",
    `[${paid ? "X" : " "}] PAGO ONLINE (Cartão de Crédito / Pix)`, "    (Não cobrar do cliente na entrega)", "",
    "-- OU (Caso seja pagamento na entrega) --", "",
    `[${paid ? " " : "X"}] COBRAR NA ENTREGA: Dinheiro`, "    Troco para: R$ 100,00", "    Levar de troco: R$ 36,12", "------",
  ].join("\n");
  assert.deepEqual(readPayment(receipt(true)), { method: "PAID" });
  assert.deepEqual(readPayment(receipt(false)), { method: "CASH", amountDueCents: 6388, changeForCents: 10000 },
    "an unticked 'pago online' must never make the courier skip collecting");
  assert.deepEqual(readPayment("[X] PAGO ONLINE (Pix)\n    (Pedido ja pago pelo app)"), { method: "PAID" });
  assert.deepEqual(readPayment("Total: R$ 40,00\n( ) Dinheiro\n(x) Cartão na entrega"), { method: "CARD", amountDueCents: 4000 });
});

test("mensagem do WhatsApp e o que não diz nada", () => {
  assert.deepEqual(readPayment("Joana Reis\nAv. Brasil, 455\nmanda troco pra 100"), { method: "CASH", changeForCents: 10000 });
  assert.deepEqual(readPayment("vou pagar no pix"), { method: "PIX" });
  assert.equal(readPayment("Cliente: Maria\nRua das Flores, 120\nTotal: R$ 52,90"), null, "a total alone says nothing about how");
  assert.equal(readPayment("Taxa de entrega R$ 7,00"), null);
});
