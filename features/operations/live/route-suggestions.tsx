"use client";

import { useEffect, useMemo, useRef } from "react";
import { suggestRoutes, type SuggestionOrder } from "../../route-planning/grouping";
import { availableCouriers, type DemoState } from "../model";
import { estimateText, lateText, reasonText } from "./route-suggestions-text";

/**
 * "Sugerir rotas" (phase 1): groups the waiting orders by the store's rules and an estimated detour,
 * most urgent first, one suggestion per courier in line. Nothing is saved here: "Usar esta rota"
 * fills the Montagem with the orders in sequence and that courier, and the store assigns as usual.
 */
export function RouteSuggestions({ open, state, now, onUse, onClose }: {
  /** Each opening reads the board as it is at that moment. */
  open: number | null;
  state: DemoState; now: number;
  onUse: (ids: string[], courierId: string | undefined) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open !== null && dialog && !dialog.open) dialog.showModal();
  }, [open]);
  return (
    <dialog ref={dialogRef} className="ops-dialog ops-suggestions" aria-labelledby="ops-suggestions-title" onClose={onClose}>
      {open !== null && <Suggestions key={open} state={state} now={now} close={() => dialogRef.current?.close()}
        onUse={(ids, courierId) => { dialogRef.current?.close(); onUse(ids, courierId); }} />}
    </dialog>
  );
}

function Suggestions({ state, now, close, onUse }: {
  state: DemoState; now: number; close: () => void;
  onUse: (ids: string[], courierId: string | undefined) => void;
}) {
  // A snapshot of the opening moment: the list does not reshuffle while the store reads it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => compute(state, now), []);
  const byId = new Map(state.orders.map(order => [order.id, order]));
  const couriers = availableCouriers(state);
  return (<>
    <div className="ops-dialog-heading">
      <div>
        <span className="ops-kicker">MONTAGEM AUTOMÁTICA</span>
        <h2 id="ops-suggestions-title">Sugestões de rota</h2>
      </div>
      <button type="button" aria-label="Fechar sugestões de rota" onClick={close}>×</button>
    </div>
    <p className="ops-suggestions-note">
      Junta pedidos do mesmo endereço, da mesma rua, do mesmo bairro, de bairros vizinhos (até 2 km) e os que ficam
      no caminho (até 10 min a mais), sem atrasar ninguém, com até 8 entregas por rota. Os tempos são estimados pela
      distância, sem trânsito: confira antes de atribuir.
    </p>

    {result.kind === "no-store" && <p className="ops-suggestions-empty" role="status">
      Para sugerir rotas, a loja precisa do endereço confirmado no mapa. Ajuste em Dados da loja.</p>}
    {result.kind === "ok" && !result.suggestions.length && !result.withoutLocation.length &&
      <p className="ops-suggestions-empty" role="status">Nenhum pedido aguardando despacho.</p>}

    {result.kind === "ok" && result.suggestions.length > 0 && (
      <ol className="ops-suggestion-list">
        {result.suggestions.map((suggestion, index) => {
          const courier = couriers[index];
          const title = `Rota sugerida ${index + 1}`;
          return (
            <li key={suggestion.stops[0].id} className="ops-suggestion" aria-label={title}>
              <div className="ops-suggestion-heading">
                <strong>{title}</strong>
                <span>{suggestion.stops.length === 1 ? "1 entrega" : `${suggestion.stops.length} entregas`} · {estimateText(suggestion.durationSeconds, suggestion.distanceMeters)}</span>
              </div>
              <p className="ops-suggestion-courier">{courier
                ? <>Motoboy: <strong dir="auto">{courier.name}</strong>{index === 0 && " · próximo da fila"}</>
                : "Sem motoboy disponível agora"}</p>
              {suggestion.lateCount > 0 && <p className="ops-suggestion-late" role="note">
                {suggestion.lateCount === 1 ? "1 pedido pode atrasar" : `${suggestion.lateCount} pedidos podem atrasar`} mesmo saindo agora.</p>}
              <ol className="ops-suggestion-stops">
                {suggestion.stops.map(stop => {
                  const order = byId.get(stop.id)!;
                  return (
                    <li key={stop.id}>
                      <span className="ops-suggestion-order"><strong>#{order.reference}</strong> <span dir="auto">{order.customer}</span>
                        {order.neighborhood && <span className="ops-suggestion-bairro" dir="auto"> · {order.neighborhood}</span>}</span>
                      <span className={`ops-suggestion-reason${stop.reason ? "" : " is-base"}`}>{reasonText(stop)}</span>
                      {stop.lateSeconds > 0 && <span className="ops-suggestion-reason is-late">{lateText(stop.lateSeconds)}</span>}
                    </li>
                  );
                })}
              </ol>
              <button type="button" className={index === 0 ? "ops-primary" : undefined}
                onClick={() => onUse(suggestion.stops.map(stop => stop.id), courier?.id)}>
                Usar esta rota na montagem
              </button>
            </li>
          );
        })}
      </ol>
    )}

    {result.kind === "ok" && result.withoutLocation.length > 0 && (
      <p className="ops-suggestions-missing">
        {result.withoutLocation.length === 1 ? "1 pedido ficou de fora" : `${result.withoutLocation.length} pedidos ficaram de fora`} por
        não ter o endereço confirmado no mapa: {result.withoutLocation.map(id => `#${byId.get(id)?.reference}`).join(", ")}.
        Edite o pedido escolhendo o endereço na busca, ou monte a rota manualmente.
      </p>
    )}
  </>);
}

function compute(state: DemoState, now: number) {
  if (!state.restaurantLocation) return { kind: "no-store" as const };
  const orders: SuggestionOrder[] = state.orders.filter(order => order.delivery === "WAITING").map(order => ({
    id: order.id, reference: order.reference, address: order.address, neighborhood: order.neighborhood,
    deadlineAt: order.orderedAt + order.promisedMinutes * 60_000, createdAt: order.createdAt,
    ...(order.location ? { location: { latitude: order.location.latitude, longitude: order.location.longitude } } : {}),
  }));
  return { kind: "ok" as const, ...suggestRoutes(state.restaurantLocation, orders, now) };
}
