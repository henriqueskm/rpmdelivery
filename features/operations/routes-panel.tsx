import { plural, type DemoState } from "./model";
import { Badge, Empty, Icon, RouteBadge } from "./ui";
import { DeadlineButton } from "./deadline-view";

export function RoutesPanel({
  state,
  onEdit,
  onCourierView,
  onRelease,
  onDeadline,
  now,
}: {
  state: DemoState;
  onEdit: (id: string) => void;
  onCourierView: (id: string) => void;
  onRelease: (id: string) => void;
  onDeadline: (id: string) => void;
  now: number;
}) {
  const issues = state.orders.filter((o) => o.delivery === "ATTEMPT_FAILED");
  return (
    <>
      <div className="ops-routes-heading">
        <h2 id="ops-routes-title">
          <Icon name="activity" /> Rotas e ocorrências
        </h2>
        <span>Preparação, saída e retorno em um só lugar</span>
      </div>
      {issues.map((o) => (
        <details className="ops-issue" key={o.id}>
          <summary>
            <span className="ops-issue-icon" aria-hidden="true">
              !
            </span>
            <strong>Ocorrência · #{o.reference}</strong>
            <span>{o.customer} · Cliente não localizado</span>
            <span className="ops-issue-action">Ver detalhes ↓</span>
          </summary>
          <div>
            <p>{o.issue}</p>
            <p>
              <strong>Destino:</strong> {o.address} · {o.neighborhood}
            </p>
            <p>
              A decisão da loja será implementada com validação no backend. Este
              exemplo não envia mensagens nem altera a entrega.
            </p>
          </div>
        </details>
      ))}
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
                className="ops-route-card"
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
                      <li key={id}>
                        <span className="ops-route-destination">
                          #{o.reference} · {o.neighborhood}
                        </span>
                        <DeadlineButton order={o} now={now} onEdit={() => onDeadline(o.id)} />
                        {o.delivery === "ATTEMPT_FAILED" && (
                          <Badge tone="red">Ocorrência</Badge>
                        )}
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
                    {r.pickupReleasedAt === null && <button className="ops-release" onClick={() => onRelease(r.id)}>
                      Liberar retirada
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
