"use client";
import { Brand } from "@/components/brand";
import {
  TRACKING_STEPS, clockTime, refreshSeconds, stopsBeforeText, trackingView, type Tracking,
} from "@/lib/tracking/view";
import { TrackingMap } from "./tracking-map";
import { useTracking } from "./use-tracking";
import "./tracking.css";

export function TrackingPage({ token }: { token: string }) {
  const { state, retry } = useTracking(token);
  return (
    <main className="tracking-page">
      <header className="tracking-header"><Brand /></header>
      {state.phase === "loading" && (
        <p className="tracking-loading" role="status"><span className="spinner dark" />Carregando seu pedido…</p>
      )}
      {state.phase === "not-found" && (
        <section className="tracking-card">
          <h1>Link não encontrado</h1>
          <p>O link pode ter expirado ou estar incompleto. Confira a mensagem que você recebeu ou fale com a loja.</p>
        </section>
      )}
      {state.phase === "error" && (
        <section className="tracking-card" role="alert">
          <h1>Não foi possível carregar</h1>
          <p>Confira sua conexão e tente de novo.</p>
          <button type="button" className="button primary tracking-retry" onClick={retry}>Tentar novamente</button>
        </section>
      )}
      {state.phase === "ready" && <TrackingDetails tracking={state.tracking} offline={state.offline} />}
    </main>
  );
}

function TrackingDetails({ tracking, offline }: { tracking: Tracking; offline: boolean }) {
  const view = trackingView(tracking);
  const stops = tracking.status === "ON_ROUTE" ? stopsBeforeText(tracking.stopsBefore) : null;
  const live = refreshSeconds(tracking.status) !== null;
  return (
    <>
      <section className={`tracking-card tone-${view.tone}`} aria-live="polite">
        <span className="eyebrow tracking-store">Pedido de {tracking.restaurantName}</span>
        <h1>{view.title}</h1>
        <p>{view.detail}</p>
        {stops && <p className="tracking-chip">{stops}</p>}
      </section>
      {view.showMap && <TrackingMap courier={tracking.courier} destination={tracking.destination} />}
      {view.step !== null && <TrackingSteps tracking={tracking} current={view.step} />}
      {offline && <p className="notice error tracking-offline" role="status">Sem conexão. Tentando atualizar…</p>}
      <footer className="tracking-footer">
        {live ? "Esta página se atualiza sozinha." : "Acompanhamento encerrado."}
      </footer>
    </>
  );
}

function TrackingSteps({ tracking, current }: { tracking: Tracking; current: number }) {
  const delivered = tracking.status === "DELIVERED";
  const times = [clockTime(tracking.startedAt), null, null, clockTime(tracking.deliveredAt)];
  return (
    <ol className="tracking-steps" aria-label="Etapas da entrega">
      {TRACKING_STEPS.map((label, index) => {
        const state = index < current || delivered ? "done" : index === current ? "current" : "pending";
        return (
          <li key={label} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="step-dot" aria-hidden="true">{state === "done" ? "✓" : ""}</span>
            <span className="step-label">
              {label}
              {times[index] && <span className="step-time">às {times[index]}</span>}
              <span className="tracking-sr-only">{state === "done" ? " (concluído)" : state === "current" ? " (agora)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
