import type { DemoOrder } from "./model";
import { calendarTime, clockTime, deadlineInfo, localDateTime } from "./deadlines";
import { deliveryFinal } from "./issue-types";
import { deliveryLabels } from "./issue-presentation";

export function DeadlineText({ order, now }: { order: DemoOrder; now: number }) {
  const info = deadlineInfo(order, now);
  const delivered = deliveryFinal(order.delivery);
  const otherDay = localDateTime(info.dueAt).slice(0, 10) !== localDateTime(now).slice(0, 10);
  return <span className={`ops-deadline ops-deadline-${delivered ? "delivered" : info.tone} ${otherDay ? "ops-deadline-other-day" : ""}`} title="Prazo prometido, sem previsão de chegada">
    {!delivered && <span className={`ops-deadline-track ${info.status === "overdue" ? "is-overdue" : ""}`}
      role="progressbar" aria-label={`Tempo restante do pedido ${order.reference}`} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(info.remaining * 100)} aria-valuetext={`${info.label}; limite ${calendarTime(info.dueAt)}`}>
      <span className="ops-deadline-fill" style={{ width: `${info.remaining * 100}%` }} />
    </span>}
    <strong>{delivered ? deliveryLabels[order.delivery] : info.label}</strong>
    <time dateTime={new Date(info.dueAt).toISOString()} title={calendarTime(info.dueAt)}>Até {otherDay ? calendarTime(info.dueAt) : clockTime(info.dueAt)}</time>
  </span>;
}
export function DeadlineButton({ order, now, onEdit }: { order: DemoOrder; now: number; onEdit: () => void }) {
  return <button className="ops-deadline-button" aria-label={`Editar prazo do pedido ${order.reference}`} title="Editar horário original e prazo prometido"
    disabled={deliveryFinal(order.delivery)} onClick={onEdit}>
    <DeadlineText order={order} now={now} />
  </button>;
}
