// "Fechar o dia": the report of the period and the shifts still open, as the server sends them.
// Pure: validated and turned into the words the store reads.

export type DayReportCourier = {
  name: string; deliveries: number; shiftFeeCents: number; deliveryFeesCents: number; totalCents: number;
  cashCents: number; cardCents: number; pixCents: number;
};
export type DayReport = {
  periodStart: string;
  periodEnd: string;
  couriers: DayReportCourier[];
  orders: { received: number; delivered: number; cancelled: number; waiting: number; onTheWay: number };
  payments: { paid: number; cashCents: number; cardCents: number; pixCents: number; notInformed: number };
  /** Saved closes only: whose shift the close ended, and who was still out on a route. */
  endedShifts?: string[];
  stillOut?: string[];
};
export type OpenShift = { shiftId: string; name: string; status: "PENDING" | "AVAILABLE" | "ON_ROUTE" | "RETURNING"; onRoute: boolean };
export type DayCloseEntry = { id: string; periodStart: string; closedAt: string; closedBy: string };
export type DayClose = { openShifts: OpenShift[]; preview: DayReport; closes: DayCloseEntry[] };

const count = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const text = (value: unknown): value is string => typeof value === "string";
const time = (value: unknown): value is string => text(value) && !Number.isNaN(Date.parse(value));
const names = (value: unknown) => value === undefined || (Array.isArray(value) && value.every(text));

/** Validates a report; anything outside the contract is refused instead of guessed. */
export function parseDayReport(value: unknown): DayReport {
  const report = value as DayReport;
  const ok = !!report && time(report.periodStart) && time(report.periodEnd) && Array.isArray(report.couriers)
    && report.couriers.every(c => text(c?.name) && [c.deliveries, c.shiftFeeCents, c.deliveryFeesCents, c.totalCents,
      c.cashCents, c.cardCents, c.pixCents].every(count))
    && !!report.orders && [report.orders.received, report.orders.delivered, report.orders.cancelled, report.orders.waiting,
      report.orders.onTheWay].every(count)
    && !!report.payments && [report.payments.paid, report.payments.cashCents, report.payments.cardCents,
      report.payments.pixCents, report.payments.notInformed].every(count)
    && names(report.endedShifts) && names(report.stillOut);
  if (!ok) throw new Error("RPM_DAY_CLOSE_UNEXPECTED");
  return report;
}

/** Validates get_day_close(). */
export function parseDayClose(value: unknown): DayClose {
  const close = value as DayClose;
  if (!close || !Array.isArray(close.openShifts) || !Array.isArray(close.closes)) throw new Error("RPM_DAY_CLOSE_UNEXPECTED");
  const shiftsOk = close.openShifts.every(s => text(s?.shiftId) && text(s.name) && typeof s.onRoute === "boolean"
    && ["PENDING", "AVAILABLE", "ON_ROUTE", "RETURNING"].includes(s.status));
  const closesOk = close.closes.every(c => text(c?.id) && time(c.periodStart) && time(c.closedAt) && text(c.closedBy));
  if (!shiftsOk || !closesOk) throw new Error("RPM_DAY_CLOSE_UNEXPECTED");
  return { openShifts: close.openShifts, preview: parseDayReport(close.preview), closes: close.closes };
}

/** "Na fila", "Aguardando aprovação", "Em rota: o turno continua até voltar". */
export function shiftLine(shift: OpenShift): string {
  if (shift.onRoute) return "Em rota: o turno continua até voltar";
  return shift.status === "PENDING" ? "Aguardando aprovação" : "Na fila";
}

/** What the close button does, said before it is pressed. */
export function closeQuestion(shifts: OpenShift[]): string {
  const ending = shifts.filter(shift => !shift.onRoute).length;
  const out = shifts.length - ending;
  const turns = ending === 0 ? "Nenhum turno para encerrar agora" : ending === 1 ? "Encerra 1 turno" : `Encerra ${ending} turnos`;
  return `${turns} e salva o relatório.${out ? ` ${out === 1 ? "1 motoboy em rota continua" : `${out} motoboys em rota continuam`} até voltar.` : ""}`;
}

const two = (value: number) => String(value).padStart(2, "0");
/** "24/11 18:05", in the store's time zone. */
export function dayTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")} ${two(Number(part("hour")))}:${part("minute")}`;
}

/** "6 pedidos recebidos · 4 entregues · 1 cancelado · 1 aguardando". */
export function ordersLine(orders: DayReport["orders"]): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    plural(orders.received, "pedido recebido", "pedidos recebidos"),
    plural(orders.delivered, "entregue", "entregues"),
    ...(orders.cancelled ? [plural(orders.cancelled, "cancelado", "cancelados")] : []),
    ...(orders.waiting ? [`${orders.waiting} aguardando despacho`] : []),
    ...(orders.onTheWay ? [`${orders.onTheWay} em andamento`] : []),
  ].join(" · ");
}
