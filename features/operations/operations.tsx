"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import dynamic from "next/dynamic";
import { Brand } from "@/components/brand";
import { optimizationScenarios, type Scenario } from "./fixtures";
import { BuilderPanel } from "./builder-panel";
import { CouriersPanel } from "./couriers-panel";
import { OrdersPanel } from "./orders-panel";
import { RoutesPanel } from "./routes-panel";
import { NewOrderDialog } from "./dialogs";
import { CourierDialog } from "./courier-dialog";
import { DeadlineDialog } from "./deadline-dialog";
import { tabs, useOperationsController } from "./use-operations-controller";
import { useOperationsClock } from "./use-operations-clock";
import { Icon } from "./ui";
import "./operations.css";
import "./operations-deadlines.css";
const OptimizationDialog = dynamic(() => import("./optimization-dialog").then(m=>m.OptimizationDialog), {
  loading: () => <p role="status">Abrindo sugestão…</p>,
});

export function Operations({
  restaurantName,
  email,
  accountAction,
  preview = false,
  initialScenario = "demo",
}: {
  restaurantName: string;
  email?: string;
  accountAction?: ReactNode;
  preview?: boolean;
  initialScenario?: Scenario;
}) {
  const now = useOperationsClock();
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const scenarioRef = useRef<HTMLSelectElement>(null);
  function changeScenario(next: Scenario) {
    setScenario(next);
    if (preview) {
      const url = new URL(window.location.href);
      url.searchParams.set("scenario", next);
      window.history.replaceState(null, "", url);
      window.requestAnimationFrame(() => scenarioRef.current?.focus());
    }
  }
  if (!now) return <main className="operations"><p role="status">Carregando demonstração operacional…</p></main>;
  return (
    <OperationsWorkspace
      key={scenario}
      now={now}
      restaurantName={restaurantName}
      email={email}
      accountAction={accountAction}
      preview={preview}
      scenario={scenario}
      onScenario={changeScenario}
      scenarioRef={scenarioRef}
    />
  );
}

function OperationsWorkspace({
  now,
  restaurantName,
  email,
  accountAction,
  preview,
  scenario,
  onScenario,
  scenarioRef,
}: {
  now: number;
  restaurantName: string;
  email?: string;
  accountAction?: ReactNode;
  preview: boolean;
  scenario: Scenario;
  onScenario: (scenario: Scenario) => void;
  scenarioRef: RefObject<HTMLSelectElement | null>;
}) {
  const {
    state, selected, setSelected, editingId, courierId, setCourierId, activeTab, setActiveTab,
    notice, courierRouteId, setCourierRouteId, deadlineTarget, setDeadlineTarget,
    newDialog, courierDialog, deadlineDialog, tabRefs,
    assign, edit, add, openNewOrder, cancel, release, revokeRelease, saveDeadline, courierCommand, tabKey,
  } = useOperationsController(scenario, now);
  const [suggesting, setSuggesting] = useState(false);
  return (
    <main className="operations">
      <header className="ops-header">
        <Brand />
        <span className="ops-header-section">Central de despacho</span>
        <div className="ops-account">
          <div>
            <strong>{restaurantName}</strong>
            {email && <small>{email}</small>}
          </div>
          {accountAction}
          {preview && <span className="ops-preview-tag">PREVIEW</span>}
        </div>
      </header>
      <div className="ops-body">
        <div className="ops-page-heading">
          <div>
            <span className="ops-kicker">BALCÃO → ENTREGA</span>
            <h1>Central de operações</h1>
            <p>Organize o despacho. Acompanhe cada saída.</p>
          </div>
          <button
            className="ops-primary"
            onClick={openNewOrder}
          >
            <Icon name="plus" /> Novo pedido
          </button>
        </div>
        <div className="ops-demo-banner">
          <span>
            <strong>Demonstração com dados fictícios.</strong> Ações locais, sem
            persistência. Recarregar restaura o exemplo.
          </span>
          {preview && (
            <label>
              Cenário
              <select
              ref={scenarioRef}
              value={scenario}
                onChange={(e) => onScenario(e.target.value as Scenario)}
              >
                <option value="demo">Operação de exemplo</option>
                <option value="worst">Textos longos</option>
                <option value="empty">Lista vazia</option>
                <option value="one">Um pedido</option>
                <option value="busy">Pico · 1.000 pedidos</option>
                {optimizationScenarios.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          )}
        </div>
        <div
          className={`ops-notice ${notice ? "has-notice" : ""}`}
          role="status"
          aria-live="polite"
        >
          {notice ||
            "Selecione pedidos para montar uma rota. A loja libera a retirada; só o motoboy inicia."}
        </div>
        <nav
          className="ops-mobile-tabs"
          role="tablist"
          aria-label="Áreas da operação"
        >
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`ops-tab-${tab.id}`}
              aria-controls={`ops-panel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onKeyDown={(e) => tabKey(e, i)}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === "builder" && selected.length > 0 && (
                <span className="ops-tab-count">{selected.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="ops-workspace">
          <section
            id="ops-panel-orders"
            role="tabpanel"
            className={`ops-panel ${activeTab === "orders" ? "is-active" : ""}`}
            aria-labelledby="ops-tab-orders"
          >
            <OrdersPanel
              state={state}
              now={now}
              onDeadline={setDeadlineTarget}
              selected={selected}
              editingId={editingId}
              onSelect={setSelected}
            />
          </section>
          <section
            id="ops-panel-builder"
            role="tabpanel"
            className={`ops-panel ${activeTab === "builder" ? "is-active" : ""}`}
            aria-labelledby="ops-tab-builder"
          >
            <BuilderPanel
              state={state}
              selected={selected}
              editingId={editingId}
              courierId={courierId}
              onSuggest={() => setSuggesting(true)}
              onCourier={setCourierId}
              onSelect={setSelected}
              onAssign={assign}
              onCancel={cancel}
            />
          </section>
          <section
            id="ops-panel-couriers"
            role="tabpanel"
            className={`ops-panel ${activeTab === "couriers" ? "is-active" : ""}`}
            aria-labelledby="ops-tab-couriers"
          >
            <CouriersPanel state={state} />
          </section>
        </div>
        <section
          id="ops-panel-routes"
          role="tabpanel"
          className={`ops-routes ${activeTab === "routes" ? "is-active" : ""}`}
          aria-labelledby="ops-tab-routes"
        >
          <RoutesPanel
            state={state}
            now={now}
            onDeadline={setDeadlineTarget}
            onRelease={release}
            onRevokeRelease={revokeRelease}
            onEdit={edit}
            onCourierView={(id) => {
              setCourierRouteId(id);
              courierDialog.current?.showModal();
            }}
          />
        </section>
        <footer className="ops-footer">
          <span>RpmDelivery · Operação em movimento.</span>
          <span>Protótipo de despacho • sem conexão operacional ao banco</span>
        </footer>
      </div>
      <NewOrderDialog dialogRef={newDialog} now={now} defaultPromiseMinutes={state.defaultPromiseMinutes} onAdd={add} />
      {suggesting && <OptimizationDialog state={state} selected={selected} editingId={editingId} scenario={scenario}
        now={now} onApply={setSelected} onClose={()=>setSuggesting(false)} />}
      <DeadlineDialog dialogRef={deadlineDialog} state={state} target={deadlineTarget} onSave={saveDeadline} onClose={() => setDeadlineTarget(undefined)} />
      <CourierDialog
        now={now}
        dialogRef={courierDialog}
        state={state}
        routeId={courierRouteId}
        onCommand={courierCommand}
      />
    </main>
  );
}
