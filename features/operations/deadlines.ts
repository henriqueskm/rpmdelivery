import type { DemoOrder, DemoRoute, DemoState } from "./model";

export const MINUTE = 60_000;
export const DEFAULT_PROMISE_MINUTES = 60;
export const MAX_PROMISE_MINUTES = 240;
export const NEAR_DEADLINE_MINUTES = 10;
export const CRITICAL_DEADLINE_MINUTES = 5;
export const DEMO_EPOCH = Date.parse("2026-10-12T18:00:00Z");

export function validPromise(minutes: number) {
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_PROMISE_MINUTES;
}
export function validOrderTime(orderedAt: number, createdAt: number) {
  return Number.isSafeInteger(orderedAt) && orderedAt > 0 &&
    Number.isSafeInteger(createdAt) && createdAt >= orderedAt &&
    Number.isFinite(new Date(createdAt).getTime());
}
export function deadlineAt(order: DemoOrder) {
  return order.orderedAt + order.promisedMinutes * MINUTE;
}
export function deadlineInfo(order: DemoOrder, now: number) {
  const dueAt = deadlineAt(order);
  const delta = dueAt - now;
  const status = delta <= 0 ? "overdue" : delta <= NEAR_DEADLINE_MINUTES * MINUTE ? "near" : "normal";
  const minutes = status === "overdue" ? Math.floor(Math.abs(delta) / MINUTE) : Math.ceil(delta / MINUTE);
  const duration = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  const tone = delta <= CRITICAL_DEADLINE_MINUTES * MINUTE ? "red" : status === "near" ? "orange" : "green";
  const label = status === "overdue"
    ? minutes ? `Vencido · ${duration}` : "Vencido agora"
    : tone === "red" ? `Crítico · ${duration}` : status === "near" ? `Próximo · ${duration}` : `Restam ${duration}`;
  const remaining = Math.max(0, Math.min(1, delta / (order.promisedMinutes * MINUTE)));
  return { dueAt, status, minutes, label, tone, remaining };
}
export function mostUrgentOrder(state: DemoState, route: DemoRoute) {
  return state.orders.filter(o => route.orderIds.includes(o.id) && o.delivery !== "DELIVERED")
    .reduce<DemoOrder | undefined>((urgent, order) =>
      !urgent || deadlineAt(order) < deadlineAt(urgent) ? order : urgent, undefined);
}
export function localDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function parseLocalDateTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && localDateTime(parsed) === value ? parsed : NaN;
}
export function clockTime(timestamp: number) {
  return clockFormatter.format(timestamp);
}
export function calendarTime(timestamp: number) {
  return calendarFormatter.format(timestamp);
}
const clockFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const calendarFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
