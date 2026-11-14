"use client";

import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import dynamic from "next/dynamic";
import { Brand } from "@/components/brand";
import { optimizationScenarios, automaticScenarios, issueScenarios, type Scenario } from "./fixtures";
import { AlertsToolbar } from "./alerts-toolbar";
import { NewIssueBanner } from "./new-issue-banner";
import { IssueCenter } from "./issue-center";
import { IssueDemoControls } from "./issue-demo-controls";
import { useIssueAlerts } from "./use-issue-alerts";
import { pendingIssues } from "./issue-presentation";
import { BuilderPanel } from "./builder-panel";
import { CouriersPanel } from "./couriers-panel";
import { OrdersPanel } from "./orders-panel";
import { RoutesPanel } from "./routes-panel";
import { NewOrderDialog } from "./dialogs";
import { CourierDialog } from "./courier-dialog";
import { DeadlineDialog } from "./deadline-dialog";
import { tabs, useOperationsController, type LiveSource } from "./use-operations-controller";
import { useOperationsBoard } from "./live/use-operations-board";
import { CourierPay } from "./live/courier-pay";
import { ConfirmDialog, type Confirmation } from "./live/confirm-dialog";
import { useOperationsClock } from "./use-operations-clock";
import { Icon } from "./ui";
import { courierLabel, plural } from "./model";
import "./operations.css";
import "./operations-deadlines.css";
import "./automatic.css";
import "./issues.css";
const AutomaticDialog = dynamic(() => import("./automatic-dialog").then(m=>m.AutomaticDialog), {
  loading: () => <p role="status">Abrindo montagem automática…</p>,
});
const OptimizationDialog = dynamic(() => import("./optimization-dialog").then(m=>m.OptimizationDialog), {
  loading: () => <p role="status">Abrindo sugestão…</p>,
});

export function Operations({
  restaurantName,
  email,
  accountAction,
  courierManagementHref,
  preview = false,
  initialScenario = "demo",
  restaurantId,
}: {
  /** With a store id the panel runs on the store's real data. */
  restaurantId?: string;
  restaurantName: string;
  email?: string;
  accountAction?: ReactNode;
  courierManagementHref?: string;
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
  if (!now) return <main className="operations"><p role="status">{restaurantId ? "Carregando a operação da loja…" : "Carregando demonstração operacional…"}</p></main>;
  if (restaurantId) return (
    <LiveOperations
      restaurantId={restaurantId}
      now={now}
      restaurantName={restaurantName}
      email={email}
      accountAction={accountAction}
      courierManagementHref={courierManagementHref}
      scenarioRef={scenarioRef}
    />
  );
  return (
    <OperationsWorkspace
      key={scenario}
      now={now}
      restaurantName={restaurantName}
      email={email}
      accountAction={accountAction}
      courierManagementHref={courierManagementHref}
      preview={preview}
      scenario={scenario}
      onScenario={changeScenario}
      scenarioRef={scenarioRef}
    />
  );
}

function LiveOperations({ restaurantId, ...props }: {
  restaurantId: string;
  now: number;
  restaurantName: string;
  email?: string;
  accountAction?: ReactNode;
  courierManagementHref?: string;
  scenarioRef: RefObject<HTMLSelectElement | null>;
}) {
  const { state, refresh, retry } = useOperationsBoard(restaurantId);
  const board = state.status === "ready" ? state.board : undefined;
  const receivedAt = state.status === "ready" ? state.receivedAt : 0;
  const live = useMemo(() => board && { restaurantId, board, receivedAt, refresh }, [board, receivedAt, restaurantId, refresh]);
  // Before the first board arrives the store still sees who is signed in and can leave.
  const shell = (content: ReactNode) => (
    <main className="operations">
      <header className="ops-header">
        <Brand />
        <div className="ops-account">
          <div>
            <strong>{props.restaurantName}</strong>
            {props.email && <small>{props.email}</small>}
          </div>
          {props.accountAction}
        </div>
      </header>
      {content}
    </main>
  );
  if (state.status === "error") return shell(
    <div className="ops-load-error" role="alert">
      <strong>Não foi possível carregar a operação.</strong>
      <span>Confira a conexão e tente de novo.</span>
      <button className="ops-primary" onClick={retry}>Tentar novamente</button>
    </div>
  );
  if (!live) return shell(<p className="ops-load-error" role="status">Carregando a operação da loja…</p>);
  return (
    <OperationsWorkspace {...props} preview={false} scenario="empty" onScenario={() => {}}
      live={live} offline={state.status === "ready" && state.offline} />
  );
}

function OperationsWorkspace({
  now,
  restaurantName,
  email,
  accountAction,
  courierManagementHref,
  preview,
  scenario,
  onScenario,
  scenarioRef,
  live,
  offline = false,
}: {
  live?: LiveSource;
  offline?: boolean;
  now: number;
  restaurantName: string;
  email?: string;
  accountAction?: ReactNode;
  courierManagementHref?: string;
  preview: boolean;
  scenario: Scenario;
  onScenario: (scenario: Scenario) => void;
  scenarioRef: RefObject<HTMLSelectElement | null>;
}) {
  const {
    state, selected, setSelected, editingId, courierId, setCourierId, activeTab, setActiveTab,
    notice, courierRouteId, setCourierRouteId, deadlineTarget, setDeadlineTarget,
    newDialog, courierDialog, deadlineDialog, issueDialog, tabRefs, pending: saving,
    assign, acceptAutomatic, edit, add, openNewOrder, cancel, release, revokeRelease, saveDeadline, courierCommand, issueCommand,
    reviewShift, cancelRoute, cancelOrder, requeue, viewedAlerts, dismissAlerts, tabKey,
  } = useOperationsController(scenario, now, live);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const askCancelOrder = (id: string) => {
    const order = state.orders.find(o => o.id === id);
    if (order) setConfirmation({ title: `Cancelar o pedido #${order.reference}?`,
      body: `${order.customer} sai da fila de despacho. O cliente não é avisado pelo sistema.`,
      action: "Cancelar pedido", run: () => void cancelOrder(id) });
  };
  const askCancelRoute = (id: string) => {
    const route = state.routes.find(r => r.id === id);
    if (route) setConfirmation({ title: `Cancelar a rota ${route.reference}?`,
      body: "Os pedidos voltam a aguardar despacho e o motoboy volta para a fila. Uma retirada já liberada é desfeita.",
      action: "Cancelar rota", run: () => void cancelRoute(id) });
  };
  const [suggesting, setSuggesting] = useState(false);
  const [automatic,setAutomatic]=useState(false);
  const automaticTrigger=useRef<HTMLButtonElement>(null);
  const routesTarget=useRef<HTMLElement>(null);
  const [highlightedRoute,setHighlightedRoute]=useState<string>();
  const alerts=useIssueAlerts(state,viewedAlerts);
  const pending=pendingIssues(state);
  const pendingShifts=state.couriers.filter(c=>courierLabel(state,c)==="Turno pendente").length;
  function followRoute(id?:string) {
    setActiveTab("routes");setHighlightedRoute(id);
    window.requestAnimationFrame(()=>{
      const target=id?document.getElementById(`ops-route-${id}`):routesTarget.current;
      target?.scrollIntoView({block:"start",behavior:"instant"});
      (window.matchMedia("(max-width: 1099px)").matches?target:routesTarget.current)?.focus({preventScroll:true});
    });
  }
  function openIssues(){issueDialog.current?.showModal();}
  return (
    <main className="operations">
      <header className="ops-header">
        <Brand />
        <span className="ops-header-section">Central de despacho</span>
        <AlertsToolbar count={pending.length} onOpen={openIssues} onFollow={()=>followRoute(pending[0]?.routeId)}
          enabled={alerts.enabled} activating={alerts.activating} onSound={alerts.toggleSound} message={alerts.message}/>
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
          <div className="ops-page-actions">{!live && <button ref={automaticTrigger} disabled={!!editingId}
            title={editingId?"Conclua ou cancele a edição da rota atual antes de usar a montagem automática.":undefined}
            onClick={()=>setAutomatic(true)}>Montagem automática</button>}
          <button
            className="ops-primary"
            onClick={openNewOrder}
          >
            <Icon name="plus" /> Novo pedido
          </button></div>
        </div>
        {live ? offline && (
          <div className="ops-demo-banner ops-offline-banner" role="status">
            <span><strong>Sem conexão.</strong> Mostrando os últimos dados; o painel tenta atualizar sozinho.</span>
          </div>
        ) : <div className="ops-demo-banner">
          <span>
            <strong>Demonstração com dados fictícios.</strong><span className="ops-demo-explanation"> Ações locais, sem
            persistência. Recarregar restaura o exemplo.</span>
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
                {automaticScenarios.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
                {issueScenarios.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          )}
        </div>}
        {preview&&scenario.startsWith("issues-")&&<IssueDemoControls state={state} onCommand={courierCommand}/>}
        <NewIssueBanner issues={alerts.alerts} state={state} now={now} onDismiss={ids=>{
          dismissAlerts(ids);window.requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(".ops-alert-count")?.focus());
        }} onOpen={openIssues} onFollow={followRoute}/>
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
              {tab.id === "couriers" && pendingShifts > 0 && (<>
                {" "}
                <span className="ops-tab-count" aria-label={plural(pendingShifts, "turno pendente", "turnos pendentes")}>
                  {pendingShifts}
                </span>
              </>)}
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
              onDeadline={live ? undefined : setDeadlineTarget}
              onCancelOrder={live ? askCancelOrder : undefined}
              onRequeue={live ? (id) => void requeue(id) : undefined}
              pending={saving}
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
              onSuggest={live ? undefined : () => setSuggesting(true)}
              live={!!live}
              pending={saving}
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
            <CouriersPanel state={state} managementHref={courierManagementHref}
              onReviewShift={live ? reviewShift : undefined} pending={saving}
              pay={live ? <CourierPay restaurantId={live.restaurantId} /> : undefined} />
          </section>
        </div>
        <section
          ref={routesTarget}
          tabIndex={-1}
          id="ops-panel-routes"
          role="tabpanel"
          className={`ops-routes ${activeTab === "routes" ? "is-active" : ""}`}
          aria-labelledby="ops-tab-routes"
        >
          <RoutesPanel
            state={state}
            now={now}
            highlightedRoute={highlightedRoute}
            onIssues={openIssues}
            onCommand={issueCommand}
            onDeadline={live ? undefined : setDeadlineTarget}
            onRelease={release}
            onRevokeRelease={revokeRelease}
            onCancelRoute={live ? askCancelRoute : undefined}
            onEdit={edit}
            onCourierView={live ? undefined : (id) => {
              setCourierRouteId(id);
              courierDialog.current?.showModal();
            }}
          />
        </section>
        <footer className="ops-footer">
          <span>RpmDelivery · Operação em movimento.</span>
          <span>{live ? "Atualiza sozinho a cada 5 segundos" : "Protótipo de despacho • sem conexão operacional ao banco"}</span>
        </footer>
      </div>
      <NewOrderDialog dialogRef={newDialog} now={now} defaultPromiseMinutes={state.defaultPromiseMinutes} onAdd={add} live={!!live} />
      {live && <ConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />}
      {automatic&&<AutomaticDialog state={state} scenario={scenario} now={now} onAccept={acceptAutomatic}
        onClose={accepted=>{setAutomatic(false);if(accepted)routesTarget.current?.focus();else automaticTrigger.current?.focus();}}/>}
      {suggesting && <OptimizationDialog state={state} selected={selected} editingId={editingId} scenario={scenario}
        now={now} onApply={setSelected} onClose={()=>setSuggesting(false)} />}
      {!live && <DeadlineDialog dialogRef={deadlineDialog} state={state} target={deadlineTarget} onSave={saveDeadline} onClose={() => setDeadlineTarget(undefined)} />}
      {!live && <CourierDialog
        now={now}
        dialogRef={courierDialog}
        state={state}
        routeId={courierRouteId}
        onCommand={courierCommand}
        onCompletedClose={followRoute}
      />}
      <IssueCenter dialogRef={issueDialog} state={state} now={now} onCommand={issueCommand} onFollow={followRoute} live={!!live}/>
    </main>
  );
}
