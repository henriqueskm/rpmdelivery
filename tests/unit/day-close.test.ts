import { test } from "node:test";
import assert from "node:assert/strict";
import { closeQuestion, dayTime, ordersLine, parseDayClose, parseDayReport, shiftLine } from "../../features/operations/live/day-close.ts";

const report = {
  periodStart: "2026-11-24T13:00:00Z", periodEnd: "2026-11-25T04:10:00Z",
  couriers: [{ name: "Ana", deliveries: 3, shiftFeeCents: 3000, deliveryFeesCents: 1500, totalCents: 4500,
    cashCents: 5290, cardCents: 0, pixCents: 3000 }],
  orders: { received: 7, delivered: 5, cancelled: 1, waiting: 1, onTheWay: 0 },
  payments: { paid: 2, cashCents: 5290, cardCents: 0, pixCents: 3000, notInformed: 1 },
};

test("relatório do fechamento: o que foge do contrato é recusado", () => {
  assert.deepEqual(parseDayReport(report), report);
  assert.deepEqual(parseDayReport({ ...report, endedShifts: ["Bruno"], stillOut: [] }).endedShifts, ["Bruno"]);
  assert.throws(() => parseDayReport({ ...report, couriers: [{ ...report.couriers[0], cashCents: -1 }] }));
  assert.throws(() => parseDayReport({ ...report, orders: undefined }));
  assert.throws(() => parseDayReport({ ...report, periodEnd: "ontem" }));
  assert.throws(() => parseDayReport({ ...report, stillOut: "Ana" }));
  const close = parseDayClose({ openShifts: [{ shiftId: "s1", name: "Ana", status: "RETURNING", onRoute: true }], preview: report,
    closes: [{ id: "c1", periodStart: report.periodStart, closedAt: report.periodEnd, closedBy: "Bia" }] });
  assert.equal(close.closes[0].closedBy, "Bia");
  assert.throws(() => parseDayClose({ openShifts: [{ shiftId: "s1", name: "Ana", status: "ENDED", onRoute: false }], preview: report, closes: [] }));
});

test("o que a loja lê antes e depois de fechar", () => {
  assert.equal(shiftLine({ shiftId: "s", name: "Ana", status: "AVAILABLE", onRoute: false }), "Na fila");
  assert.equal(shiftLine({ shiftId: "s", name: "Ana", status: "PENDING", onRoute: false }), "Aguardando aprovação");
  assert.equal(shiftLine({ shiftId: "s", name: "Ana", status: "AVAILABLE", onRoute: true }), "Em rota: o turno continua até voltar");
  const line = (status: "AVAILABLE" | "RETURNING", onRoute: boolean) => ({ shiftId: "s", name: "x", status, onRoute });
  assert.equal(closeQuestion([line("AVAILABLE", false)]), "Encerra 1 turno e salva o relatório.");
  assert.equal(closeQuestion([line("AVAILABLE", false), line("AVAILABLE", false), line("RETURNING", true)]),
    "Encerra 2 turnos e salva o relatório. 1 motoboy em rota continua até voltar.");
  assert.equal(closeQuestion([]), "Nenhum turno para encerrar agora e salva o relatório.");
  assert.equal(ordersLine(report.orders), "7 pedidos recebidos · 5 entregues · 1 cancelado · 1 aguardando despacho");
  assert.equal(ordersLine({ received: 1, delivered: 1, cancelled: 0, waiting: 0, onTheWay: 2 }),
    "1 pedido recebido · 1 entregue · 2 em andamento");
  // Store time: 04:10 UTC is 01:10 in São Paulo, still the night of the 24th's shift.
  assert.equal(dayTime("2026-11-25T04:10:00Z"), "25/11 01:10");
});
