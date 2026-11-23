"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import {
  DEFAULT_SUGGESTION_PARAMETERS, neighborhoodCenters, suggestRoutes, type NeighborhoodCenters, type SuggestionOrder,
  type SuggestionParameters, type SuggestionResult,
} from "../../route-planning/grouping";
import { parseStreetTable, streetLegs } from "../../route-planning/street-legs";
import { availableCouriers, type DemoState } from "../model";
import { estimateText, lateText, metersText, reasonText, splitText } from "./route-suggestions-text";

/** Street times for at most this many points (the store and the most urgent orders). */
const STREET_POINTS = 60;

/**
 * "Sugerir rotas": groups the waiting orders by the store's rules and the detour on the streets,
 * most urgent first, one suggestion per courier in line. Nothing is saved here: "Usar esta rota"
 * fills the Montagem with the orders in sequence and that courier, and the store assigns as usual.
 */
export function RouteSuggestions({ open, restaurantId, state, now, onUse, onClose }: {
  /** Each opening reads the board as it is at that moment. */
  open: number | null;
  restaurantId: string;
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
      {open !== null && <Suggestions key={open} restaurantId={restaurantId} state={state} now={now}
        close={() => dialogRef.current?.close()}
        onUse={(ids, courierId) => { dialogRef.current?.close(); onUse(ids, courierId); }} />}
    </dialog>
  );
}

type Settings = SuggestionParameters & { canEdit: boolean };
type Computed = { result: SuggestionResult; settings: Settings; streets: "all" | "partial" | "none" };

function Suggestions({ restaurantId, state, now, close, onUse }: {
  /** [now] is read once, at the opening (see [snapshot]). */
  restaurantId: string; state: DemoState; now: number; close: () => void;
  onUse: (ids: string[], courierId: string | undefined) => void;
}) {
  // A snapshot of the opening moment: the list does not reshuffle while the store reads it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const input = useMemo(() => snapshot(state, now), []);
  const [computed, setComputed] = useState<Computed | null>(null);
  useEffect(() => {
    if (!input) return;
    let current = true;
    void (async () => {
      const [settings, table, centers] = await Promise.all([
        loadSettings(restaurantId), loadStreets(restaurantId, input.points), loadCenters(restaurantId)]);
      if (!current) return;
      const streets = table ? streetLegs(input.points, table) : undefined;
      setComputed({
        result: suggestRoutes(input.store, input.orders, input.now, settings, streets, centers, input.freeCouriers),
        settings, streets: !table ? "none" : table.partial ? "partial" : "all",
      });
    })();
    return () => { current = false; };
    // Once per opening: the clock ticking must not ask for the street times again.
  }, [input, restaurantId]);

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

    {!input && <p className="ops-suggestions-empty" role="status">
      Para sugerir rotas, a loja precisa do endereço confirmado no mapa. Ajuste em Dados da loja.</p>}
    {input && !computed && <p className="ops-courier-card-loading" role="status">Calculando tempos pelas ruas…</p>}

    {computed && <>
      <p className="ops-suggestions-note">
        Junta pedidos do mesmo endereço, da mesma rua, do mesmo bairro, de bairros vizinhos
        (até {metersText(computed.settings.neighborMeters)}) e os que ficam no caminho
        (até {Math.round(computed.settings.maxDetourSeconds / 60)} min a mais), sem atrasar ninguém, com até {computed.settings.maxStops} {computed.settings.maxStops === 1 ? "entrega" : "entregas"} por rota.{" "}
        Com mais motoboys livres do que rotas, divide as maiores para nenhum ficar parado.{" "}
        {computed.streets === "all" && "Tempos pelas ruas, sem trânsito."}
        {computed.streets === "partial" && "Tempos pelas ruas, alguns ainda estimados pela distância."}
        {computed.streets === "none" && "Sem os tempos das ruas agora: tempos estimados pela distância. Confira antes de atribuir."}
        {computed.settings.canEdit && <> <Link href="/loja">Ajustar limites em Dados da loja</Link>.</>}
      </p>

      {!computed.result.suggestions.length && !computed.result.withoutLocation.length &&
        <p className="ops-suggestions-empty" role="status">Nenhum pedido aguardando despacho.</p>}

      {computed.result.suggestions.length > 0 && (
        <ol className="ops-suggestion-list">
          {computed.result.suggestions.map((suggestion, index) => {
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
                {suggestion.split && <p className="ops-suggestion-split">{splitText(suggestion.split)}</p>}
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

      {computed.result.withoutLocation.length > 0 && (
        <p className="ops-suggestions-missing">
          {computed.result.withoutLocation.length === 1 ? "1 pedido ficou de fora" : `${computed.result.withoutLocation.length} pedidos ficaram de fora`} por
          não ter o endereço confirmado no mapa: {computed.result.withoutLocation.map(id => `#${byId.get(id)?.reference}`).join(", ")}.
          Edite o pedido escolhendo o endereço na busca, ou monte a rota manualmente.
        </p>
      )}
    </>}
  </>);
}

/** The store and its waiting orders at the opening moment; null without the store's pin. */
function snapshot(state: DemoState, now: number) {
  if (!state.restaurantLocation) return null;
  const store = { latitude: state.restaurantLocation.latitude, longitude: state.restaurantLocation.longitude };
  const orders: SuggestionOrder[] = state.orders.filter(order => order.delivery === "WAITING").map(order => ({
    id: order.id, reference: order.reference, address: order.address, neighborhood: order.neighborhood,
    deadlineAt: order.orderedAt + order.promisedMinutes * 60_000, createdAt: order.createdAt,
    ...(order.location ? { location: { latitude: order.location.latitude, longitude: order.location.longitude } } : {}),
  }));
  // Street times for the store and the most urgent pinned orders; the rest are estimated.
  const pinned = orders.filter(order => order.location).sort((a, b) => a.deadlineAt - b.deadlineAt || a.createdAt - b.createdAt);
  const points = [store, ...pinned.slice(0, STREET_POINTS - 1).map(order => order.location!)];
  // Couriers waiting in line now: with more of them than routes, the longest routes are split.
  return { store, orders, points, now, freeCouriers: availableCouriers(state).length };
}

/** The store's limits; the defaults when they cannot be read. */
async function loadSettings(restaurantId: string): Promise<Settings> {
  const fallback = { ...DEFAULT_SUGGESTION_PARAMETERS, canEdit: false };
  try {
    const { data, error } = await getSupabase().rpc("get_route_settings", { p_restaurant_id: restaurantId });
    const value = data as Record<string, unknown> | null;
    if (error || !value || !Number.isInteger(value.maxStops) || !Number.isInteger(value.maxDetourMinutes)
      || !Number.isInteger(value.neighborMeters)) return fallback;
    return { ...DEFAULT_SUGGESTION_PARAMETERS, maxStops: value.maxStops as number,
      maxDetourSeconds: (value.maxDetourMinutes as number) * 60, neighborMeters: value.neighborMeters as number,
      canEdit: value.canEdit === true };
  } catch { return fallback; }
}

/** Where each bairro is, from the store's past orders; without it, neighbors go by the two orders' distance. */
async function loadCenters(restaurantId: string): Promise<NeighborhoodCenters | undefined> {
  try {
    const { data, error } = await getSupabase().rpc("get_neighborhood_centers", { p_restaurant_id: restaurantId });
    if (error || !Array.isArray(data)) return undefined;
    const valid = (data as Record<string, unknown>[]).filter(c => typeof c.neighborhood === "string"
      && typeof c.latitude === "number" && typeof c.longitude === "number" && Number.isInteger(c.orders)) as
      { neighborhood: string; latitude: number; longitude: number; orders: number }[];
    return neighborhoodCenters(valid);
  } catch { return undefined; }
}

/** Street times among [points] from the panel's server (cached per store); null when unavailable. */
async function loadStreets(restaurantId: string, points: { latitude: number; longitude: number }[]) {
  if (points.length < 2) return null;
  try {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const response = await fetch("/api/routing/legs", {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ restaurantId, points }),
    });
    return response.ok ? parseStreetTable(await response.json(), points.length) : null;
  } catch { return null; }
}
