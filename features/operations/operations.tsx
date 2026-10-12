"use client";

import {
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type KeyboardEvent,
} from "react";
import { Brand } from "@/components/brand";
import { createDemoState, type Scenario } from "./fixtures";
import {
  availableCouriers,
  operationsReducer,
  type Command,
  type NewOrder,
} from "./model";
import { BuilderPanel } from "./builder-panel";
import { CouriersPanel } from "./couriers-panel";
import { OrdersPanel } from "./orders-panel";
import { RoutesPanel } from "./routes-panel";
import { CourierDialog, NewOrderDialog } from "./dialogs";
import { Icon } from "./ui";
import "./operations.css";

const tabs = [
  { id: "orders", label: "Pedidos" },
  { id: "builder", label: "Montagem" },
  { id: "couriers", label: "Motoboys" },
  { id: "routes", label: "Rotas" },
] as const;
type Tab = (typeof tabs)[number]["id"];

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
  return (
    <OperationsWorkspace
      key={scenario}
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
  restaurantName,
  email,
  accountAction,
  preview,
  scenario,
  onScenario,
  scenarioRef,
}: {
  restaurantName: string;
  email?: string;
  accountAction?: ReactNode;
  preview: boolean;
  scenario: Scenario;
  onScenario: (scenario: Scenario) => void;
  scenarioRef: RefObject<HTMLSelectElement | null>;
}) {
  const [state, dispatch] = useReducer(
    operationsReducer,
    scenario,
    createDemoState,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [courierId, setCourierId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("orders");
  const [notice, setNotice] = useState("");
  const [courierRouteId, setCourierRouteId] = useState<string>();
  const newDialog = useRef<HTMLDialogElement>(null);
  const courierDialog = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function showArea(tab: Tab) {
    setActiveTab(tab);
    if (window.matchMedia("(max-width: 1099px)").matches) {
      tabRefs.current[tabs.findIndex((t) => t.id === tab)]?.focus();
    }
  }
  function cancel() {
    setSelected([]);
    setEditingId(undefined);
    setCourierId("");
  }
  function assign() {
    const chosen = editingId
      ? state.routes.find((r) => r.id === editingId)?.courierId
      : (availableCouriers(state).find((c) => c.id === courierId)?.id ??
        availableCouriers(state)[0]?.id);
    if (!chosen) return;
    const command: Command = {
      type: "assign",
      ids: selected,
      courierId: chosen,
      editingId,
    };
    if (operationsReducer(state, command) === state) {
      setNotice(
        "Não foi possível montar essa rota. Confira os pedidos e a disponibilidade.",
      );
      return;
    }
    dispatch(command);
    setNotice(
      editingId
        ? "Montagem atualizada na demonstração. O início continua dependendo do motoboy."
        : "Rota em PREPARING. Motoboy reservado; aguardando início manual pelo motoboy. Nada foi enviado.",
    );
    cancel();
    showArea("routes");
  }
  function edit(id: string) {
    const route = state.routes.find(
      (r) => r.id === id && r.status === "PREPARING",
    );
    if (!route) return;
    setSelected([...route.orderIds]);
    setEditingId(id);
    setCourierId(route.courierId);
    showArea("builder");
    setNotice(
      `Editando ${route.reference}. Pedidos e sequência podem mudar enquanto PREPARING.`,
    );
  }
  function add(order: NewOrder) {
    dispatch({ type: "add", order });
    setActiveTab("orders");
    setNotice(
      "Pedido fictício cadastrado. Aguardando despacho; disponível somente nesta sessão da página.",
    );
  }
  function courierCommand(command: Command) {
    dispatch(command);
    setNotice(
      command.type === "start"
        ? "Início manual simulado pelo motoboy. ON_ROUTE; sequência bloqueada. Tracking e notificações não foram ativados."
        : command.type === "finish"
          ? "Entregas concluídas na simulação. Motoboy retornando, ainda fora da fila."
          : "Retorno confirmado na simulação. Motoboy no final da fila de disponíveis.",
    );
    if (command.type === "start" && command.routeId === editingId) cancel();
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 3
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    setActiveTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  }
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
            onClick={() => {
              newDialog.current?.showModal();
              newDialog.current
                ?.querySelector<HTMLInputElement>('input[name="customer"]')
                ?.focus();
            }}
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
            "Selecione pedidos para montar uma rota. O início é sempre feito pelo motoboy."}
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
      <NewOrderDialog dialogRef={newDialog} onAdd={add} />
      <CourierDialog
        dialogRef={courierDialog}
        state={state}
        routeId={courierRouteId}
        onCommand={courierCommand}
      />
    </main>
  );
}
