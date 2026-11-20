import { plural, type DemoState, type Command } from "./model";
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

export function RoutesPanel({
  state,
  onEdit,
  onCourierView,
  onRelease,
  onRevokeRelease,
  onCancelRoute,
  onDeadline,
  now,
  onIssues, onCommand, highlightedRoute,
}: {
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
}) {
  const issues = pendingIssues(state);
  const far = farDeliveries(state);
  return (
    <>
      <div className="ops-routes-heading">
        <h2 id="ops-routes-title">
          <Icon name="activity" /> Rotas e ocorrências
        </h2>
        <span>Preparação, saída e retorno em um só lugar</span>
      </div>
      {issues.length>0&&<div className="ops-route-pending"><strong>! {plural(issues.length,"ocorrência aguardando decisão","ocorrências aguardando decisão")}</strong><button onClick={onIssues}>Abrir Central de ocorrências</button></div>}
      {far.length>0&&<p className="ops-route-far-summary" role="note"><strong>{plural(far.length,"entrega confirmada longe do endereço","entregas confirmadas longe do endereço")}</strong> · confira com o motoboy e o cliente.</p>}
      {!state.routes.length ? (
        <Empty title="Nenhuma rota neste momento">
          Atribua pedidos a um motoboy disponível para criar uma rota em
          preparação.
        </Empty>
      ) : (
        <div className="ops-route-grid">
          {state.routes.map((r) => {
            const courier = state.couriers.find((c) => c.id === r.courierId)!;
            const delivered = r.orderIds.filter(
              (id) =>
                state.orders.find((o) => o.id === id)?.delivery === "DELIVERED",
            ).length;
            return (
              <article
                className={`ops-route-card ${highlightedRoute===r.id?"is-highlighted":""}`}
                id={`ops-route-${r.id}`} tabIndex={-1}
                key={r.id}
                aria-label={`Rota ${r.reference}`}
              >
                <div className="ops-route-card-top">
                  <strong>{r.reference}</strong>
                  <RouteBadge status={r.status} />
                </div>
                <h3 dir="auto">{courier.name}</h3>
                <span className="ops-route-progress">
                  {plural(r.orderIds.length, "entrega", "entregas")} ·{" "}
                  {delivered} entregues
                </span>
                <ol>
                  {r.orderIds.map((id) => {
                    const o = state.orders.find((o) => o.id === id)!;
                    return (
                      <li key={id} data-delivery={o.delivery}>
                        <span className="ops-route-destination">
                          #{o.reference} · {o.neighborhood}
                        </span>
                        <DeadlineButton order={o} now={now} onEdit={onDeadline && (() => onDeadline(o.id))} />
                        {o.delivery === "ATTEMPT_FAILED" && (
                          <button className="ops-route-issue-link" onClick={onIssues}>! Decisão pendente</button>
                        )}
                        {o.delivery!=="ATTEMPT_FAILED"&&o.delivery!=="ASSIGNED"&&o.delivery!=="ON_ROUTE"&&o.delivery!=="NEXT"&&<Badge tone={o.delivery==="DELIVERED"?"green":"neutral"}>{deliveryLabels[o.delivery]}</Badge>}
                        {o.farMeters!==undefined&&<span className="ops-route-far">! Entregue a {distanceLabel(o.farMeters)} do endereço</span>}
                        {r.status==="ON_ROUTE"&&deliveryEligible(o.delivery)&&<details className="ops-route-cancel"><summary>Mais ações · #{o.reference}</summary><button onClick={()=>{
                          onCommand({type:"delivery-cancel",routeId:r.id,orderId:o.id,actorId:DEMO_STORE_ACTOR,now:Date.now(),commandId:`store:${o.id}:cancel`});
                        }}>Cancelar entrega #{o.reference}{onCancelRoute ? "" : " — simulação"}</button></details>}
                      </li>
                    );
                  })}
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
                    {r.pickupReleasedAt === null ? <button className="ops-release" onClick={() => onRelease(r.id)}>
                      Liberar retirada
                    </button> : <button onClick={() => onRevokeRelease(r.id)}>
                      Cancelar liberação
                    </button>}
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
          })}
        </div>
      )}
    </>
  );
}
