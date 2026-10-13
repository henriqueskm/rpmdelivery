import { useState } from "react";
import type { DemoState, Command } from "./model";
import { DEMO_STORE_ACTOR, ISSUE_REASONS, type DemoIssue, type IssueDecision } from "./issue-types";
import { issueTiming, RESOLUTIONS } from "./issue-presentation";
import { calendarTime } from "./deadlines";

export function IssueCard({issue,state,now,onCommand,onFollow}:{
  issue: DemoIssue; state: DemoState; now: number;
  onCommand: (command: Command) => boolean; onFollow: (id: string) => void;
}) {
  const [confirmCancel,setConfirmCancel] = useState(false);
  const order = state.orders.find(o => o.id === issue.orderId)!,route = state.routes.find(r => r.id === issue.routeId)!,
    courier = state.couriers.find(c => c.id === issue.courierId)!;
  const timing = issueTiming(issue,now);
  function decide(decision: IssueDecision) {
    onCommand({type: "issue-decide", issueId: issue.id, decision, actorId: DEMO_STORE_ACTOR,
      now: Date.now(), commandId: `${issue.id}:decision`});
  }
  const history = state.events.filter(e => e.issueId === issue.id && !["ALERT_VIEWED","ALERT_DISMISSED"].includes(e.type));
  return <article className="ops-issue-card" data-tone={timing.tone} aria-label={`Ocorrência do pedido ${order.reference}`}>
    <div className="ops-issue-card-top"><strong>#{order.reference} · {order.customer}</strong>
      <span>{issue.status === "PENDING" ? timing.remaining : RESOLUTIONS[issue.resolution!]}</span></div>
    <p className="ops-issue-who">{route.reference} · {courier.name} · {order.neighborhood}</p>
    <h3>{ISSUE_REASONS[issue.reason]}</h3>
    <p className="ops-issue-time">{issue.status === "PENDING" ? timing.elapsed : `Encerrada ${calendarTime(issue.closedAt!)}`} · informada {calendarTime(issue.reportedAt)}</p>
    <div className="ops-issue-context">
      {order.complement&&<p><strong>Referência:</strong> {order.complement}</p>}
      {order.notes&&<p><strong>Observação do pedido:</strong> {order.notes}</p>}
      {issue.description&&<p><strong>Relato do motoboy:</strong> {issue.description}</p>}
    </div>
    {issue.status === "PENDING" && <div className="ops-issue-decisions">
      {!confirmCancel ? <><button className="ops-primary" onClick={() => decide("RETRY")}>Tentar novamente</button>
        <button onClick={() => decide("RETURN")}>Retornar pedido à loja</button></>
        : <div className="ops-issue-cancel-confirm"><strong>Cancelar entrega #{order.reference}?</strong><span>O pedido será pulado e continuará visível como cancelado.</span>
          <button onClick={() => setConfirmCancel(false)}>Voltar</button><button className="ops-danger-button" onClick={() => decide("CANCEL")}>Confirmar cancelamento</button></div>}
    </div>}
    <details className="ops-issue-detail"><summary>Detalhes e histórico</summary>
      <p><strong>Destino:</strong> {order.address} · {order.neighborhood}</p>{order.complement&&<p>{order.complement}</p>}
      <p>Limite de resposta: {calendarTime(issue.decisionDeadline)}. Prazo fixado ao registrar a falha.</p>
      <ol>{history.map(event => <li key={event.id}>{calendarTime(event.at)} · {event.actorType === "SYSTEM" ? "Sistema demonstrativo" : event.actorType === "STORE" ? "Operador demonstrativo" : courier.name} · {
        event.type === "DELIVERY_ATTEMPT_FAILED" ? "Falha registrada" : event.detail && Object.hasOwn(RESOLUTIONS,event.detail) ? RESOLUTIONS[event.detail as keyof typeof RESOLUTIONS] : "Decisão registrada"
      }</li>)}</ol>
      <button onClick={() => onFollow(route.id)}>Acompanhar rota {route.reference}</button>
      {issue.status === "PENDING" && !confirmCancel && <button onClick={() => setConfirmCancel(true)}>Cancelar entrega</button>}
    </details>
  </article>;
}
