import { plural, type DemoOrder, type DemoRoute, type DemoState, type Command, type RouteOutcome } from "./model";
import { pendingIssues, deliveryLabels } from "./issue-presentation";
import { DEMO_STORE_ACTOR, deliveryEligible } from "./issue-types";
import { Badge, Empty, Icon, RouteBadge } from "./ui";
import { DeadlineButton } from "./deadline-view";

/** Orders delivered more than 300 m from their pin (real data only). */
export const farDeliveries = (state: DemoState) => state.orders.filter(o => o.farMeters !== undefined);

/** "350 m", "1,2 km". */
export function distanceLabel(meters: number) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m`
    : `${(meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}

/** What a stop shows on this route: how it ended here, or its live status while still on it. */
type StopView = { label: string; tone: "green" | "neutral" | "amber"; settled: boolean };
const outcomeLabels: Record<RouteOutcome, StopView> = {
  DELIVERED: { label: "Entregue", tone: "green", settled: true },
  RETURNED: { label: "Devolvido", tone: "amber", settled: true },
  CANCELLED: { label: "Cancelado", tone: "neutral", settled: true },
};
export function stopView(state: DemoState, routeId: string, order: DemoOrder): StopView | null {
  const outcome = state.routeOutcomes?.[`${routeId}:${order.id}`];
  if (outcome) return outcomeLabels[outcome];
  if (order.delivery === "DELIVERED") return outcomeLabels.DELIVERED;
  if (order.delivery === "CANCELLED") return outcomeLabels.CANCELLED;
  // Still on the route: the deadline says more than a status, except for these two.
  if (order.delivery === "RETURN_TO_STORE") return { label: deliveryLabels.RETURN_TO_STORE, tone: "amber", settled: false };
  if (order.delivery === "NEXT") return { label: "Próxima", tone: "neutral", settled: false };
  return null;
}

/** Waiting for the store first, then on the street, then heading back. Server order (newest first) within each. */
const rank = (route: DemoRoute) => route.status === "PREPARING" ? (route.pickupReleasedAt === null ? 0 : 1)
  : route.status === "ON_ROUTE" ? 2 : route.status === "RETURNING" ? 3 : 4;

type Props = {
  state: DemoState;
  onEdit: (id: string) => void;
  /** Real data: undo a route still in preparation (asks first). */
  onCancelRoute?: (id: string) => void;
  /** Demo only: real routes are driven from the courier's phone. */
  onCourierView?: (id: string) => void;
  onRelease: (id: string) => void;
  onRevokeRelease: (id: string) => void;
  onDeadline?: (id: string) => void;
  now: number;
  onIssues: () => void; onCommand: (command: Command) => boolean | Promise<boolean>; highlightedRoute?: string;
};

export function RoutesPanel(props: Props) {
  const { state, onIssues } = props;
  const issues = pendingIssues(state);
  const far = farDeliveries(state);
  const active = state.routes.filter(r => r.status !== "COMPLETED").sort((a, b) => rank(a) - rank(b));
  const done = state.routes.filter(r => r.status === "COMPLETED");
  return (
    <>
      <div className="ops-panel-heading ops-routes-heading">
        <h2 id="ops-routes-title">
          <Icon name="activity" /> Rotas
        </h2>
        <Badge>{active.length}</Badge>
      </div>
      <div className="ops-routes-scroll">
        {issues.length>0&&<div className="ops-route-pending"><strong>! {plural(issues.length,"ocorrência aguardando decisão","ocorrências aguardando decisão")}</strong><button onClick={onIssues}>Abrir Central de ocorrências</button></div>}
        {far.length>0&&<p className="ops-route-far-summary" role="note"><strong>{plural(far.length,"entrega confirmada longe do endereço","entregas confirmadas longe do endereço")}</strong> · confira com o motoboy e o cliente.</p>}
        {!state.routes.length ? (
          <Empty title="Nenhuma rota neste momento">
            Atribua pedidos a um motoboy disponível para criar uma rota em
            preparação.
          </Empty>
        ) : <>
          {active.length === 0 && <p className="ops-routes-quiet">Nenhuma rota em andamento.</p>}
          <div className="ops-route-grid">{active.map(route => <RouteCard key={route.id} route={route} {...props} />)}</div>
          {/* Finished routes stay for the day, folded: they no longer need the store. */}
          {done.length > 0 && <details className="ops-routes-done">
            <summary>Concluídas hoje · {done.length}</summary>
            <div className="ops-route-grid">{done.map(route => <RouteCard key={route.id} route={route} {...props} />)}</div>
          </details>}
        </>}
      </div>
    </>
  );
}

function RouteCard({ route: r, state, now, onEdit, onCancelRoute, onCourierView, onRelease, onRevokeRelease, onDeadline,
  onIssues, onCommand, highlightedRoute }: Props & { route: DemoRoute }) {
  const courier = state.couriers.find((c) => c.id === r.courierId)!;
  const stops = r.orderIds.map(id => state.orders.find(o => o.id === id)!).map(o => ({ o, view: stopView(state, r.id, o) }));
  const delivered = stops.filter(s => s.view?.label === "Entregue").length;
  const returned = stops.filter(s => s.view?.label === "Devolvido").length;
  const waitingRelease = r.status === "PREPARING" && r.pickupReleasedAt === null;
  return (
    <article
      className={`ops-route-card ${highlightedRoute===r.id?"is-highlighted":""} ${waitingRelease?"is-waiting-release":""}`}
      id={`ops-route-${r.id}`} tabIndex={-1}
      aria-label={`Rota ${r.reference}`}
    >
      <div className="ops-route-card-top">
        <strong>{r.reference}</strong>
        <RouteBadge status={r.status} />
      </div>
      <h3 dir="auto">{courier.name}</h3>
      <span className="ops-route-progress">
        {plural(r.orderIds.length, "entrega", "entregas")} · {delivered} {delivered === 1 ? "entregue" : "entregues"}
        {returned > 0 && ` · ${plural(returned, "devolvido", "devolvidos")}`}
      </span>
      {/* The store's one job on a new route, first and big: release the pickup. Undoing it uses the same
          slot (same element), so keyboard focus stays put when one turns into the other. */}
      {r.status === "PREPARING" && (waitingRelease
        ? <button className="ops-release ops-release-main" onClick={() => onRelease(r.id)}>Liberar retirada</button>
        : <button className="ops-release-undo" onClick={() => onRevokeRelease(r.id)}>Cancelar liberação</button>)}
      <ol>
        {stops.map(({ o, view }) => (
          <li key={o.id} data-delivery={o.delivery}>
            <div className="ops-route-stop">
              <span className="ops-route-destination">#{o.reference} · {o.neighborhood}</span>
              {view && <Badge tone={view.tone}>{view.label}</Badge>}
            </div>
            {!view?.settled && <DeadlineButton order={o} now={now} onEdit={onDeadline && (() => onDeadline(o.id))} />}
            {o.delivery === "ATTEMPT_FAILED" && !view?.settled && (
              <button className="ops-route-issue-link" onClick={onIssues}>! Decisão pendente</button>
            )}
            {o.farMeters!==undefined&&<span className="ops-route-far">! Entregue a {distanceLabel(o.farMeters)} do endereço</span>}
            {r.status==="ON_ROUTE"&&!view?.settled&&deliveryEligible(o.delivery)&&<details className="ops-route-cancel"><summary>Mais ações · #{o.reference}</summary><button onClick={()=>{
              onCommand({type:"delivery-cancel",routeId:r.id,orderId:o.id,actorId:DEMO_STORE_ACTOR,now:Date.now(),commandId:`store:${o.id}:cancel`});
            }}>Cancelar entrega #{o.reference}{onCancelRoute ? "" : " — simulação"}</button></details>}
          </li>
        ))}
      </ol>
      <p className={`ops-route-hint ${r.status === "PREPARING" ? r.pickupReleasedAt === null ? "ops-pickup-waiting" : "ops-pickup-ready" : ""}`}>
        {r.status === "PREPARING"
          ? r.pickupReleasedAt === null ? "Aguardando liberação · todos os pedidos juntos" : "Pronto para retirada · início exclusivo pelo motoboy"
          : r.status === "ON_ROUTE"
            ? "Composição e sequência bloqueadas"
            : r.status === "RETURNING"
              ? "Aguardando confirmação de retorno"
              : "Retorno confirmado · rota encerrada"}
      </p>
      <div className="ops-route-buttons">
        {r.status === "PREPARING" && (
          <>
          <button onClick={() => onEdit(r.id)}>
            Editar montagem
          </button>
          {onCancelRoute && <button className="ops-link-button" onClick={() => onCancelRoute(r.id)}
            aria-label={`Cancelar rota ${r.reference}`}>Cancelar rota</button>}
          </>
        )}
        {onCourierView && r.status !== "COMPLETED" && (
          <button
            className="ops-link-button"
            onClick={() => onCourierView(r.id)}
          >
            Visão do motoboy (demo)
          </button>
        )}
      </div>
    </article>
  );
}
