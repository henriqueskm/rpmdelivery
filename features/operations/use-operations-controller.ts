import { useReducer, useRef, useState, type KeyboardEvent } from "react";
import { createDemoState, type Scenario } from "./fixtures";
import { availableCouriers, operationsReducer, type Command, type NewOrder } from "./model";
import { localDateTime } from "./deadlines";
import type { AssignmentProposal } from "./automatic-assignment";
import type { PlannedGroup, PlanningParameters } from "../route-planning/types";

export const tabs = [
  { id: "orders", label: "Pedidos" }, { id: "builder", label: "Montagem" },
  { id: "couriers", label: "Motoboys" }, { id: "routes", label: "Rotas" },
] as const;
type Tab = (typeof tabs)[number]["id"];

export function useOperationsController(scenario: Scenario, seedTime: number) {
  const [state, dispatch] = useReducer(operationsReducer, scenario, s => createDemoState(s, seedTime));
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [courierId, setCourierId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("orders");
  const [notice, setNotice] = useState("");
  const [courierRouteId, setCourierRouteId] = useState<string>();
  const [deadlineTarget, setDeadlineTarget] = useState<string>();
  const newDialog = useRef<HTMLDialogElement>(null);
  const courierDialog = useRef<HTMLDialogElement>(null);
  const deadlineDialog = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function showArea(tab: Tab) {
    setActiveTab(tab);
    if (window.matchMedia("(max-width: 1099px)").matches)
      tabRefs.current[tabs.findIndex(t => t.id === tab)]?.focus();
  }
  function cancel() { setSelected([]); setEditingId(undefined); setCourierId(""); }
  function assign() {
    const chosen = editingId ? state.routes.find(r => r.id === editingId)?.courierId
      : (availableCouriers(state).find(c => c.id === courierId)?.id ?? availableCouriers(state)[0]?.id);
    if (!chosen) return;
    const command: Command = { type: "assign", ids: selected, courierId: chosen, editingId };
    const next = operationsReducer(state, command);
    if (next === state) {
      setNotice("Não foi possível montar essa rota. Confira os pedidos e a disponibilidade.");
      return;
    }
    const previous = state.routes.find(r => r.id === editingId);
    const updated = next.routes.find(r => r.id === editingId);
    dispatch(command);
    setNotice(editingId
      ? previous?.pickupReleasedAt && updated?.pickupReleasedAt === null
        ? "Pedidos alterados. Retirada voltou a Aguardando liberação; libere todos novamente."
        : updated?.pickupReleasedAt ? "Sequência atualizada. Liberação de retirada preservada."
          : "Montagem atualizada. Aguardando liberação da loja e início manual pelo motoboy."
      : "Rota em PREPARING. Motoboy reservado; aguardando liberação da loja. Nada foi enviado.");
    cancel(); showArea("routes");
  }
  function acceptAutomatic(proposal:AssignmentProposal,groups:PlannedGroup[],parameters:PlanningParameters) {
    const command:Command={type:"batch-assign",proposal,groups,parameters,now:Date.now()};
    if(operationsReducer(state,command)===state) {
      setNotice("A operação mudou. Nenhuma rota foi atribuída; recalcule as propostas.");return false;
    }
    dispatch(command);
    const assignedIds=new Set(groups.flatMap(g=>g.ids));
    setSelected(ids=>ids.filter(id=>!assignedIds.has(id)));setCourierId("");showArea("routes");
    const remaining=state.orders.filter(o=>o.delivery==="WAITING").length-groups.reduce((n,g)=>n+g.ids.length,0);
    setNotice(`${groups.length} rota(s) demonstrativas em preparação. ${remaining} pedidos seguem aguardando. Motoboys reservados; a loja libera e só eles iniciam. Nenhum tracking ou notificação.`);
    return true;
  }
  function edit(id: string) {
    const route = state.routes.find(r => r.id === id && r.status === "PREPARING");
    if (!route) return;
    setSelected([...route.orderIds]); setEditingId(id); setCourierId(route.courierId);
    showArea("builder");
    setNotice(`Editando ${route.reference}. Mudar os pedidos exige nova liberação; só reordenar preserva a retirada liberada.`);
  }
  function add(order: NewOrder) {
    const command: Command = { type: "add", order, now: Date.now() };
    if (operationsReducer(state, command) === state) return false;
    dispatch(command); setActiveTab("orders");
    setNotice("Pedido fictício cadastrado. Aguardando despacho; disponível somente nesta sessão da página.");
    return true;
  }
  function openNewOrder() {
    const form = newDialog.current?.querySelector("form");
    if (form) {
      (form.elements.namedItem("orderedAt") as HTMLInputElement).value = localDateTime(Date.now());
      (form.elements.namedItem("promisedMinutes") as HTMLInputElement).value = String(state.defaultPromiseMinutes);
    }
    newDialog.current?.showModal();
    newDialog.current?.querySelector<HTMLInputElement>('input[name="customer"]')?.focus();
  }
  function release(id: string) {
    const route = state.routes.find(r => r.id === id);
    if (!route) return;
    const command: Command = { type: "release", routeId: id, expectedOrderIds: [...route.orderIds], now: Date.now() };
    if (operationsReducer(state, command) === state) {
      setNotice("A rota mudou ou não pode ser liberada. Confira sua montagem atual."); return;
    }
    dispatch(command);
    setNotice(`Todos os ${route.orderIds.length} pedidos de ${route.reference} liberados juntos. PREPARING; início exclusivo pelo motoboy, sem tracking ou notificações.`);
  }
  function saveDeadline(command: Command) {
    if (operationsReducer(state, command) === state) return false;
    dispatch(command);
    setNotice(command.type === "default-promise" ? "Prazo padrão atualizado só para novos pedidos nesta demonstração."
      : "Prazo prometido atualizado. Sequência preservada; isto não prevê a chegada.");
    return true;
  }
  function revokeRelease(id: string) {
    const command: Command = { type: "revoke-release", routeId: id };
    if (operationsReducer(state, command) === state) {
      setNotice("Não foi possível cancelar a liberação. A rota precisa estar em preparação e já liberada."); return;
    }
    dispatch(command);
    setNotice("Liberação cancelada. Aguardando liberação; início do motoboy bloqueado. Pedidos, sequência e reserva preservados.");
  }
  function courierCommand(command: Command) {
    if (operationsReducer(state, command) === state) {
      setNotice("Ação bloqueada. Confira a liberação, a rota e o motoboy atribuído."); return;
    }
    dispatch(command);
    setNotice(command.type === "start"
      ? "Início manual simulado pelo motoboy após recolher os pedidos. ON_ROUTE; sequência bloqueada. Tracking e notificações não foram ativados."
      : command.type === "finish" ? "Entregas concluídas na simulação. Motoboy retornando, ainda fora da fila."
        : "Retorno confirmado na simulação. Motoboy no final da fila de disponíveis.");
    if (command.type === "start" && command.routeId === editingId) cancel();
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 3
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setActiveTab(tabs[next].id); tabRefs.current[next]?.focus();
  }
  return { state, selected, setSelected, editingId, courierId, setCourierId, activeTab, setActiveTab,
    notice, courierRouteId, setCourierRouteId, deadlineTarget, setDeadlineTarget,
    newDialog, courierDialog, deadlineDialog, tabRefs,
    assign, acceptAutomatic, edit, add, openNewOrder, cancel, release, revokeRelease, saveDeadline, courierCommand, tabKey };
}
