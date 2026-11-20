import { useMemo, type RefObject } from "react";
import { plural, type DemoOrder, type DemoRoute, type DemoState } from "./model";
import { CopyTrackingLink } from "./copy-tracking-link";
import { RoutesMap, type MapCourier, type MapStop } from "./routes-map";
import { clockTime } from "./deadlines";
import { DeadlineText } from "./deadline-view";
import { distanceLabel, stopView } from "./routes-panel";
import { RouteBadge } from "./ui";

/**
 * "Acompanhar rotas": every route on the street at a glance, bigger than the column. For each one:
 * who, how long ago it left, how far along it is, and each stop in order — delivered, next, still
 * to go, or waiting for a store decision (with the way to decide it).
 */
export function RouteTracker({ dialogRef, state, now, onIssues, open, onClose }: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  state: DemoState;
  now: number;
  /** The map exists only while the screen is open (Mapbox bills each map created). */
  open: boolean;
  onClose: () => void;
  /** Opens the Central de ocorrências (closing this screen first). */
  onIssues: () => void;
}) {
  const street = state.routes.filter(r => r.status === "ON_ROUTE" || r.status === "RETURNING")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "ON_ROUTE" ? -1 : 1));
  const waiting = state.routes.filter(r => r.status === "PREPARING");
  const close = () => dialogRef.current?.close();
  // The courier of each route on the street (recent GPS only) and each route's next stop.
  const couriers = useMemo<MapCourier[]>(() => street.flatMap(route => {
    const at = state.routePositions?.[route.id];
    return at ? [{ routeId: route.id, reference: route.reference, ...at }] : [];
  }), [street, state.routePositions]);
  const stops = useMemo<MapStop[]>(() => street.flatMap(route => {
    const next = route.orderIds.map(id => state.orders.find(o => o.id === id)).find(o => o?.delivery === "NEXT");
    return next?.location ? [{ id: next.id, reference: next.reference, latitude: next.location.latitude, longitude: next.location.longitude }] : [];
  }), [street, state.orders]);
  return (
    <dialog ref={dialogRef} className="ops-dialog ops-tracker" aria-labelledby="ops-tracker-title" onClose={onClose}>
      <div className="ops-tracker-head">
        <div>
          <h2 id="ops-tracker-title">Rotas em andamento</h2>
          <p>{street.length ? plural(street.length, "rota na rua", "rotas na rua") : "Nenhuma rota na rua agora."}
            {waiting.length > 0 && ` · ${plural(waiting.length, "aguardando retirada", "aguardando retirada")}`}</p>
        </div>
        <button type="button" className="ops-tracker-close" onClick={close} aria-label="Fechar acompanhamento">×</button>
      </div>
      {open && street.length > 0 && (couriers.length > 0 || stops.length > 0) &&
        <RoutesMap store={state.restaurantLocation} couriers={couriers} stops={stops} />}
      {street.length > 0 && <div className="ops-tracker-grid">
        {street.map(route => <TrackedRoute key={route.id} route={route} state={state} now={now}
          onIssues={() => { close(); onIssues(); }} />)}
      </div>}
      {waiting.length > 0 && <p className="ops-tracker-waiting">
        Aguardando retirada: {waiting.map(r => `${r.reference} · ${state.couriers.find(c => c.id === r.courierId)?.name ?? "motoboy"}`
          + (r.pickupReleasedAt === null ? " (liberar retirada)" : "")).join(" · ")}
      </p>}
    </dialog>
  );
}

function minutesAgo(since: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  return minutes < 1 ? "agora" : minutes < 60 ? `há ${minutes} min` : `há ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function TrackedRoute({ route, state, now, onIssues }: { route: DemoRoute; state: DemoState; now: number; onIssues: () => void }) {
  const courier = state.couriers.find(c => c.id === route.courierId);
  const stops = route.orderIds.map(id => state.orders.find(o => o.id === id)!).filter(Boolean);
  const views = stops.map(o => ({ o, view: stopView(state, route.id, o) }));
  const delivered = views.filter(v => v.view?.label === "Entregue").length;
  const settled = views.filter(v => v.view?.settled).length;
  return (
    <article className="ops-tracker-route" aria-label={`Acompanhamento da rota ${route.reference}`}>
      <div className="ops-tracker-route-top">
        <strong>{route.reference}</strong>
        <RouteBadge status={route.status} />
      </div>
      <h3 dir="auto">{courier?.name ?? "Motoboy"}</h3>
      <p className="ops-tracker-meta">
        {route.startedAt ? `Saiu ${minutesAgo(route.startedAt, now)}` : "Na rua"}
        {" · "}{delivered} de {stops.length} {stops.length === 1 ? "entregue" : "entregues"}
      </p>
      <div className="ops-tracker-progress" role="progressbar" aria-label={`Progresso da rota ${route.reference}`}
        aria-valuemin={0} aria-valuemax={stops.length} aria-valuenow={settled}>
        <span style={{ width: `${stops.length ? (settled / stops.length) * 100 : 0}%` }} />
      </div>
      {route.status === "RETURNING" && <p className="ops-tracker-returning">Voltando para a loja</p>}
      <ol className="ops-tracker-stops">
        {views.map(({ o, view }) => <TrackedStop key={o.id} order={o} view={view} now={now} onIssues={onIssues}
          deliveredAt={state.deliveredAt?.[`${route.id}:${o.id}`]} />)}
      </ol>
    </article>
  );
}

function TrackedStop({ order: o, view, now, onIssues, deliveredAt }: {
  order: DemoOrder; view: ReturnType<typeof stopView>; now: number; onIssues: () => void;
  /** Real data: when it was delivered on this route. */
  deliveredAt?: number;
}) {
  const failed = o.delivery === "ATTEMPT_FAILED" && !view?.settled;
  const next = o.delivery === "NEXT" && !view?.settled;
  const mark = view?.label === "Entregue" ? "✓" : failed ? "!" : next ? "●" : view?.settled ? "–" : "○";
  return (
    <li className={`ops-tracker-stop ${next ? "is-next" : ""} ${failed ? "is-failed" : ""} ${view?.settled ? "is-settled" : ""}`}>
      <span className="ops-tracker-mark" aria-hidden="true">{mark}</span>
      <div className="ops-tracker-stop-body">
        <div className="ops-tracker-stop-line">
          <strong>#{o.reference} · {o.neighborhood || "sem bairro"}</strong>
          <span className="ops-tracker-stop-state">
            {view?.label === "Entregue" && deliveredAt ? `Entregue às ${clockTime(deliveredAt)}`
              : view?.settled ? view.label : failed ? "Ocorrência" : next ? "Próxima" : o.delivery === "RETURN_TO_STORE" ? "Voltando à loja" : "Na rota"}
          </span>
        </div>
        <span className="ops-tracker-customer" dir="auto">{o.customer}</span>
        {!view?.settled && !failed && <DeadlineText order={o} now={now} />}
        {o.farMeters !== undefined && <span className="ops-route-far">! Entregue a {distanceLabel(o.farMeters)} do endereço</span>}
        {failed && <button type="button" className="ops-tracker-decide" onClick={onIssues}>Decidir ocorrência #{o.reference}</button>}
        {!view?.settled && <span className="ops-tracker-link"><CopyTrackingLink token={o.trackingToken} reference={o.reference} className="ops-link-button" /></span>}
      </div>
    </li>
  );
}
