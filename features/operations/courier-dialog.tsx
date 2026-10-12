import { useRef, type RefObject } from "react";
import type { Command, DemoState } from "./model";
import { mostUrgentOrder } from "./deadlines";
import { DeadlineText } from "./deadline-view";
import { RouteBadge } from "./ui";

export function CourierDialog({
  dialogRef,
  state,
  routeId,
  onCommand,
  now,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  state: DemoState;
  routeId?: string;
  onCommand: (command: Command) => void;
  now: number;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const route = state.routes.find((r) => r.id === routeId);
  const courier = state.couriers.find((c) => c.id === route?.courierId);
  const urgent = route && mostUrgentOrder(state, route);
  const hasIssue = state.orders.some(
    (o) => route?.orderIds.includes(o.id) && o.delivery === "ATTEMPT_FAILED",
  );
  return (
    <dialog
      ref={dialogRef}
      className="ops-dialog ops-courier-dialog"
      aria-labelledby="ops-courier-view-title"
    >
      <div className="ops-dialog-heading">
        <div>
          <span className="ops-kicker">VISÃO SEPARADA • DEMONSTRAÇÃO</span>
          <h2 id="ops-courier-view-title">Aplicativo do motoboy</h2>
        </div>
        <button
          ref={closeRef}
          aria-label="Fechar visão do motoboy"
          onClick={() => dialogRef.current?.close()}
        >
          ×
        </button>
      </div>
      {route && courier && (
        <>
          <p className="ops-dialog-notice">
            Simulação local. Sem autenticação real, tracking ou notificações.
            As ações reais exigirão validação no backend.
          </p>
          <div className="ops-courier-route">
            <strong>
              {courier.name} · {route.reference}
            </strong>
            <RouteBadge status={route.status} />
          </div>
          {route.status === "PREPARING" && <p className={`ops-pickup ${route.pickupReleasedAt === null ? "is-waiting" : "is-released"}`}>
            <strong>{route.pickupReleasedAt === null ? "Aguardando liberação" : "Pronto para retirada"}</strong>
            <span>{route.pickupReleasedAt === null ? "Você já pode conferir a rota. Aguarde a loja liberar todos os pedidos."
              : "Recolha todos os pedidos e confirme o início abaixo."}</span>
          </p>}
          {urgent && <div className="ops-urgent-deadline">
            <span>Prazo mais urgente · #{urgent.reference}</span>
            <DeadlineText order={urgent} now={now} />
          </div>}
          <p className="ops-deadline-help">Contagem do prazo prometido, sem previsão de trajeto ou garantia de chegada.</p>
          <ol className="ops-courier-deliveries">
            {route.orderIds.map((id) => {
              const o = state.orders.find((o) => o.id === id)!;
              return (
                <li key={id}>
                  <strong>
                    #{o.reference} · {o.customer}
                  </strong>
                  <span>
                    {o.address} · {o.neighborhood}
                  </span>
                  {o.complement && <span>{o.complement}</span>}
                  {o.notes && <p>{o.notes}</p>}
                  <DeadlineText order={o} now={now} />
                </li>
              );
            })}
          </ol>
          {route.status === "PREPARING" && <p className="ops-courier-action-hint">Só o motoboy atribuído confirma a retirada e inicia a rota.</p>}
          {route.status === "ON_ROUTE" && (
            <>
              <p>
                Rota iniciada pelo motoboy. A composição e a sequência estão
                bloqueadas.
              </p>
              {hasIssue && (
                <p className="ops-dialog-notice">
                  Resolva a ocorrência com a loja antes de concluir. Essa
                  decisão não está implementada na demonstração.
                </p>
              )}
            </>
          )}
          {route.status === "RETURNING" && (
            <p>
              Entregas concluídas. Você só volta à fila depois de confirmar que
              retornou ao restaurante.
            </p>
          )}
          {route.status !== "COMPLETED" && (
            <button
              className="ops-primary"
              disabled={(route.status === "PREPARING" && route.pickupReleasedAt === null) || (route.status === "ON_ROUTE" && hasIssue)}
              onClick={() => {
                if (route.status === "RETURNING") closeRef.current?.focus();
                onCommand({
                  type:
                    route.status === "PREPARING"
                      ? "start"
                      : route.status === "ON_ROUTE"
                        ? "finish"
                        : "arrive",
                  routeId: route.id,
                  actorId: courier.id,
                });
              }}
            >
              {
                {
                  PREPARING: "Recolhi os pedidos · Iniciar rota",
                  ON_ROUTE: "Simular entregas concluídas",
                  RETURNING: "Confirmar retorno — simulação",
                }[route.status]
              }
            </button>
          )}
          {route.status === "COMPLETED" && (
            <p role="status">
              Retorno confirmado. Você entrou no final da fila de disponíveis.
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
