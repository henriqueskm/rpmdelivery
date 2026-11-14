import { test } from "node:test";
import assert from "node:assert/strict";
import { centsInput, formatCents, parseCourierPay, parseReais } from "../../features/operations/live/pay.ts";

test("valores digitados pela loja viram centavos", () => {
  assert.equal(parseReais("30"), 3000);
  assert.equal(parseReais("7,5"), 750);
  assert.equal(parseReais("7,50"), 750);
  assert.equal(parseReais("R$ 1.000,00"), 100_000);
  assert.equal(parseReais("0"), 0);
  assert.equal(parseReais(" 12,3 "), 1230);
});

test("valores fora de R$ 0 a R$ 1.000 ou malformados são recusados", () => {
  for (const text of ["", "-5", "1.000,01", "1000,001", "abc", "7.5", "12,345", "1,2,3"]) {
    assert.equal(parseReais(text), null, text);
  }
});

test("centavos aparecem em reais", () => {
  assert.equal(formatCents(3700), "R$ 37,00");
  assert.equal(formatCents(0), "R$ 0,00");
  assert.equal(formatCents(123456), "R$ 1.234,56");
  assert.equal(centsInput(3000), "30,00");
  assert.equal(centsInput(705), "7,05");
});

test("a resposta do acerto é validada", () => {
  const pay = { day: "2026-11-14", shiftFeeCents: 3000, deliveryFeeCents: 700, canEdit: true,
    couriers: [{ name: "Ana", deliveries: 3, shiftFeeCents: 3000, deliveryFeesCents: 2100, totalCents: 5100 }] };
  assert.deepEqual(parseCourierPay(pay), pay);
  assert.throws(() => parseCourierPay(null));
  assert.throws(() => parseCourierPay({ ...pay, shiftFeeCents: -1 }));
  assert.throws(() => parseCourierPay({ ...pay, couriers: [{ name: "Ana", deliveries: 1.5, shiftFeeCents: 0, deliveryFeesCents: 0, totalCents: 0 }] }));
});
