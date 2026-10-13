import { plural, type DemoState, type Command } from "./model";
import { pendingIssues, deliveryLabels } from "./issue-presentation";
import { DEMO_STORE_ACTOR, deliveryEligible } from "./issue-types";
import { Badge, Empty, Icon, RouteBadge } from "./ui";
import { DeadlineButton } from "./deadline-view";

export function RoutesPanel({
  state,
  onEdit,
  onCourierView,
  onRelease,
  onRevokeRelease,
  onDeadline,
  now,
  onIssues, onCommand, highlightedRoute,
}: {
  state: DemoState;
  onEdit: (id: string) => void;
  onCourierView: (id: string) => void;
  onRelease: (id: string) => void;
  onRevokeRelease: (id: string) => void;
  onDeadline: (id: string) => void;
  now: number;
  onIssues: () => void; onCommand: (command: Command) => boolean; highlightedRoute?: string;
}) {
  const issues = pendingIssues(state);
  return (
    <>
      <div className="ops-routes-heading">
        <h2 id="ops-routes-title">
          <Icon name="activity" /> Rotas e ocorrências
        </h2>
        <span>Preparação, saída e retorno em um só lugar</span>
      </div>
      {issues.length>0&&<div className="ops-route-pending"><strong>! {plural(issues.length,"ocorrência aguardando decisão","ocorrências aguardando decisão")}</strong><button onClick={onIssues}>Abrir Central de ocorrências</button></div>}
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
                        <DeadlineButton order={o} now={now} onEdit={() => onDeadline(o.id)} />
                        {o.delivery === "ATTEMPT_FAILED" && (
                          <button className="ops-route-issue-link" onClick={onIssues}>! Decisão pendente</button>
                        )}
                        {o.delivery!=="ATTEMPT_FAILED"&&o.delivery!=="ASSIGNED"&&o.delivery!=="ON_ROUTE"&&o.delivery!=="NEXT"&&<Badge tone={o.delivery==="DELIVERED"?"green":"neutral"}>{deliveryLabels[o.delivery]}</Badge>}
                        {r.status==="ON_ROUTE"&&deliveryEligible(o.delivery)&&<details className="ops-route-cancel"><summary>Mais ações · #{o.reference}</summary><button onClick={()=>{
                          onCommand({type:"delivery-cancel",routeId:r.id,orderId:o.id,actorId:DEMO_STORE_ACTOR,now:Date.now(),commandId:`store:${o.id}:cancel`});
                        }}>Cancelar entrega #{o.reference} — simulação</button></details>}
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
                    </>
                  )}
                  {r.status !== "COMPLETED" && (
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
