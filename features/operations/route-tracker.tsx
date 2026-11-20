import { useMemo, type RefObject } from "react";
import { plural, type Command, type DemoOrder, type DemoRoute, type DemoState } from "./model";
import { CopyTrackingLink } from "./copy-tracking-link";
import { RoutesMap, type MapCourier, type MapStop } from "./routes-map";
import { clockTime } from "./deadlines";
import { DeadlineButton } from "./deadline-view";
import { distanceLabel, farDeliveries, stopView } from "./routes-panel";
import { pendingIssues } from "./issue-presentation";
import { DEMO_STORE_ACTOR, deliveryEligible } from "./issue-types";
import { Empty, RouteBadge } from "./ui";

/** Routes the store still has to release: the panel's banner points here. */
export const routesToRelease = (state: DemoState) =>
  state.routes.filter(r => r.status === "PREPARING" && r.pickupReleasedAt === null);

export type RouteActions = {
  onRelease: (id: string) => void;
  onRevokeRelease: (id: string) => void;
  /** Leaves this screen for the Montagem column. */
  onEdit: (id: string) => void;
  /** Real data: undo a route still in preparation (asks first). */
  onCancelRoute?: (id: string) => void;
  /** Demo only: real routes are driven from the courier's phone. */
  onCourierView?: (id: string) => void;
  /** Demo only: edit a promised time. */
  onDeadline?: (id: string) => void;
  onCommand: (command: Command) => boolean | Promise<boolean>;
  /** Opens the Central de ocorrências (closing this screen first). */
  onIssues: () => void;
};

/**
 * "Acompanhar rotas": the store's one place for routes. First the ones waiting for the store (release
 * the pickup), then the map and the routes on the street, stop by stop, then the day's finished ones,
 * folded. Every action the store has on a route lives on its card here.
 */
export function RouteTracker({ dialogRef, state, now, open, onClose, highlightedRoute, showMap, ...actions }: RouteActions & {
  dialogRef: RefObject<HTMLDialogElement | null>;
  state: DemoState;
  now: number;
  /** The map exists only while the screen is open (Mapbox bills each map created). */
  open: boolean;
  onClose: () => void;
  highlightedRoute?: string;
  /** Real data only: the demo has no store pin or GPS, and loads nothing from Mapbox. */
  showMap: boolean;
}) {
  const street = state.routes.filter(r => r.status === "ON_ROUTE" || r.status === "RETURNING")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "ON_ROUTE" ? -1 : 1));
  // Waiting for the store's release first, then already released.
  const waiting = state.routes.filter(r => r.status === "PREPARING")
    .sort((a, b) => Number(a.pickupReleasedAt !== null) - Number(b.pickupReleasedAt !== null));
  const done = state.routes.filter(r => r.status === "COMPLETED");
  const issues = pendingIssues(state);
  const far = farDeliveries(state);
  const close = () => dialogRef.current?.close();
  const leaving = { ...actions,
    onIssues: () => { close(); actions.onIssues(); },
    onEdit: (id: string) => { close(); actions.onEdit(id); } };
  // The courier of each route on the street (recent GPS only) and each route's next stop.
  const couriers = useMemo<MapCourier[]>(() => street.flatMap(route => {
    const at = state.routePositions?.[route.id];
    return at ? [{ routeId: route.id, reference: route.reference, ...at }] : [];
  }), [street, state.routePositions]);
  const stops = useMemo<MapStop[]>(() => street.flatMap(route => {
    const next = route.orderIds.map(id => state.orders.find(o => o.id === id)).find(o => o?.delivery === "NEXT");
    return next?.location ? [{ id: next.id, reference: next.reference, latitude: next.location.latitude, longitude: next.location.longitude }] : [];
  }), [street, state.orders]);
  const card = (route: DemoRoute) => <RouteCard key={route.id} route={route} state={state} now={now}
    highlighted={highlightedRoute === route.id} {...leaving} />;
  return (
    <dialog ref={dialogRef} className="ops-dialog ops-tracker" aria-labelledby="ops-tracker-title" onClose={onClose}>
      <div className="ops-tracker-head">
        <div>
          <h2 id="ops-tracker-title">Acompanhar rotas</h2>
          <p>{street.length ? plural(street.length, "rota na rua", "rotas na rua") : "Nenhuma rota na rua agora."}
            {waiting.length > 0 && ` · ${plural(waiting.length, "aguardando retirada", "aguardando retirada")}`}</p>
        </div>
        <button type="button" className="ops-tracker-close" onClick={close} aria-label="Fechar acompanhamento">×</button>
      </div>
      {issues.length > 0 && <div className="ops-route-pending">
        <strong>! {plural(issues.length, "ocorrência aguardando decisão", "ocorrências aguardando decisão")}</strong>
        <button type="button" onClick={leaving.onIssues}>Abrir Central de ocorrências</button>
      </div>}
      {far.length > 0 && <p className="ops-route-far-summary" role="note">
        <strong>{plural(far.length, "entrega confirmada longe do endereço", "entregas confirmadas longe do endereço")}</strong>
        {" "}· confira com o motoboy e o cliente.</p>}
      {!state.routes.length && <Empty title="Nenhuma rota neste momento">
        Atribua pedidos a um motoboy disponível para criar uma rota em preparação.
      </Empty>}
      {waiting.length > 0 && <section className="ops-tracker-section" aria-labelledby="ops-tracker-waiting">
        <h3 id="ops-tracker-waiting">Aguardando retirada</h3>
        <div className="ops-tracker-grid">{waiting.map(card)}</div>
      </section>}
      {street.length > 0 && <section className="ops-tracker-section" aria-labelledby="ops-tracker-street">
        <h3 id="ops-tracker-street">Na rua</h3>
        {showMap && open && (couriers.length > 0 || stops.length > 0) &&
          <RoutesMap store={state.restaurantLocation} couriers={couriers} stops={stops} />}
        <div className="ops-tracker-grid">{street.map(card)}</div>
      </section>}
      {state.routes.length > 0 && !waiting.length && !street.length &&
        <p className="ops-routes-quiet">Nenhuma rota em andamento.</p>}
      {/* Finished routes stay for the day, folded: they no longer need the store. */}
      {done.length > 0 && <details className="ops-routes-done">
        <summary>Concluídas hoje · {done.length}</summary>
        <div className="ops-tracker-grid">{done.map(card)}</div>
      </details>}
    </dialog>
  );
}

function minutesAgo(since: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  return minutes < 1 ? "agora" : minutes < 60 ? `há ${minutes} min` : `há ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const hints = {
  WAITING: "Aguardando liberação · todos os pedidos juntos",
  RELEASED: "Pronto para retirada · início exclusivo pelo motoboy",
  ON_ROUTE: "Composição e sequência bloqueadas",
  RETURNING: "Aguardando confirmação de retorno",
  COMPLETED: "Retorno confirmado · rota encerrada",
};

function RouteCard({ route: r, state, now, highlighted, onRelease, onRevokeRelease, onEdit, onCancelRoute, onCourierView,
  onDeadline, onCommand, onIssues }: RouteActions & { route: DemoRoute; state: DemoState; now: number; highlighted: boolean }) {
  const courier = state.couriers.find(c => c.id === r.courierId);
  const stops = r.orderIds.map(id => state.orders.find(o => o.id === id)!).filter(Boolean);
  const views = stops.map(o => ({ o, view: stopView(state, r.id, o) }));
  const delivered = views.filter(v => v.view?.label === "Entregue").length;
  const returned = views.filter(v => v.view?.label === "Devolvido").length;
  const settled = views.filter(v => v.view?.settled).length;
  const preparing = r.status === "PREPARING";
  const waitingRelease = preparing && r.pickupReleasedAt === null;
  const hint = preparing ? (waitingRelease ? hints.WAITING : hints.RELEASED) : hints[r.status as keyof typeof hints];
  return (
    <article id={`ops-route-${r.id}`} tabIndex={-1} aria-label={`Rota ${r.reference}`}
      className={`ops-tracker-route ${highlighted ? "is-highlighted" : ""} ${waitingRelease ? "is-waiting-release" : ""}`}>
      <div className="ops-tracker-route-top">
        <strong>{r.reference}</strong>
        <RouteBadge status={r.status} />
      </div>
      <h4 dir="auto">{courier?.name ?? "Motoboy"}</h4>
      <p className="ops-tracker-meta">
        {preparing ? plural(stops.length, "entrega", "entregas") : <>
          {r.startedAt ? `Saiu ${minutesAgo(r.startedAt, now)}` : "Na rua"}
          {" · "}{delivered} de {stops.length} {stops.length === 1 ? "entregue" : "entregues"}
          {returned > 0 && ` · ${plural(returned, "devolvido", "devolvidos")}`}
        </>}
      </p>
      {/* The store's one job on a new route, first and big: release the pickup. Undoing it uses the same
          slot (same element), so keyboard focus stays put when one turns into the other. */}
      {preparing && (waitingRelease
        ? <button type="button" className="ops-release ops-release-main" onClick={() => onRelease(r.id)}>Liberar retirada</button>
        : <button type="button" className="ops-release-undo" onClick={() => onRevokeRelease(r.id)}>Cancelar liberação</button>)}
      {!preparing && <div className="ops-tracker-progress" role="progressbar" aria-label={`Progresso da rota ${r.reference}`}
        aria-valuemin={0} aria-valuemax={stops.length} aria-valuenow={settled}>
        <span style={{ width: `${stops.length ? (settled / stops.length) * 100 : 0}%` }} />
      </div>}
      {r.status === "RETURNING" && <p className="ops-tracker-returning">Voltando para a loja</p>}
      <ol className="ops-tracker-stops">
        {views.map(({ o, view }) => <Stop key={o.id} route={r} order={o} view={view} now={now} onIssues={onIssues}
          onDeadline={onDeadline} onCommand={onCommand} live={!!onCancelRoute}
          deliveredAt={state.deliveredAt?.[`${r.id}:${o.id}`]} />)}
      </ol>
      <p className={`ops-route-hint ${preparing ? waitingRelease ? "ops-pickup-waiting" : "ops-pickup-ready" : ""}`}>{hint}</p>
      {(preparing || (onCourierView && r.status !== "COMPLETED")) && <div className="ops-route-buttons">
        {preparing && <button type="button" onClick={() => onEdit(r.id)}>Editar montagem</button>}
        {preparing && onCancelRoute && <button type="button" className="ops-link-button" onClick={() => onCancelRoute(r.id)}
          aria-label={`Cancelar rota ${r.reference}`}>Cancelar rota</button>}
        {onCourierView && r.status !== "COMPLETED" &&
          <button type="button" className="ops-link-button" onClick={() => onCourierView(r.id)}>Visão do motoboy (demo)</button>}
      </div>}
    </article>
  );
}

function Stop({ route, order: o, view, now, onIssues, onDeadline, onCommand, live, deliveredAt }: {
  route: DemoRoute; order: DemoOrder; view: ReturnType<typeof stopView>; now: number; live: boolean;
  onIssues: () => void; onDeadline?: (id: string) => void; onCommand: RouteActions["onCommand"];
  /** Real data: when it was delivered on this route. */
  deliveredAt?: number;
}) {
  const failed = o.delivery === "ATTEMPT_FAILED" && !view?.settled;
  const next = o.delivery === "NEXT" && !view?.settled;
  const preparing = route.status === "PREPARING";
  const mark = view?.label === "Entregue" ? "✓" : failed ? "!" : next ? "●" : view?.settled ? "–" : "○";
  const state = view?.label === "Entregue" && deliveredAt ? `Entregue às ${clockTime(deliveredAt)}`
    : view?.settled ? view.label : failed ? "Ocorrência" : next ? "Próxima"
      : o.delivery === "RETURN_TO_STORE" ? "Voltando à loja" : preparing ? "" : "Na rota";
  return (
    <li data-delivery={o.delivery}
      className={`ops-tracker-stop ${next ? "is-next" : ""} ${failed ? "is-failed" : ""} ${view?.settled ? "is-settled" : ""}`}>
      <span className="ops-tracker-mark" aria-hidden="true">{mark}</span>
      <div className="ops-tracker-stop-body">
        <div className="ops-tracker-stop-line">
          <strong className="ops-route-destination">#{o.reference} · {o.neighborhood || "sem bairro"}</strong>
          {state && <span className="ops-tracker-stop-state">{state}</span>}
        </div>
        <span className="ops-tracker-customer" dir="auto">{o.customer}</span>
        {!view?.settled && !failed && <DeadlineButton order={o} now={now} onEdit={onDeadline && (() => onDeadline(o.id))} />}
        {o.farMeters !== undefined && <span className="ops-route-far">! Entregue a {distanceLabel(o.farMeters)} do endereço</span>}
        {failed && <button type="button" className="ops-tracker-decide" onClick={onIssues}>Decidir ocorrência #{o.reference}</button>}
        {!view?.settled && !preparing && <span className="ops-tracker-link">
          <CopyTrackingLink token={o.trackingToken} reference={o.reference} className="ops-link-button" /></span>}
        {route.status === "ON_ROUTE" && !view?.settled && deliveryEligible(o.delivery) && <details className="ops-route-cancel">
          <summary>Mais ações · #{o.reference}</summary>
          <button type="button" onClick={() => void onCommand({ type: "delivery-cancel", routeId: route.id, orderId: o.id,
            actorId: DEMO_STORE_ACTOR, now: Date.now(), commandId: `store:${o.id}:cancel` })}>
            Cancelar entrega #{o.reference}{live ? "" : " — simulação"}</button>
        </details>}
      </div>
    </li>
  );
}
