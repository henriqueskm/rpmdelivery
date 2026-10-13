import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { createDemoState, type Scenario } from "./fixtures";
import { availableCouriers, operationsReducer, type Command, type NewOrder } from "./model";
import { localDateTime } from "./deadlines";
import type { AssignmentProposal } from "./automatic-assignment";
import type { PlannedGroup, PlanningParameters } from "../route-planning/types";
import { DEMO_STORE_ACTOR } from "./issue-types";
import { RESOLUTIONS } from "./issue-presentation";

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
  const [feedback, setFeedback] = useState({text:"",cursor:0});
  const setNotice = (text: string) => setFeedback({text,cursor:state.events.length});
  const lastAutomatic = state.events.findLastIndex(e => e.type === "ISSUE_AUTO_RETURNED");
  const automaticEvent = state.events[lastAutomatic];
  const notice = lastAutomatic >= feedback.cursor && automaticEvent
    ? `Pedido #${state.orders.find(o => o.id === automaticEvent.orderId)?.reference}: ${RESOLUTIONS[automaticEvent.detail as keyof typeof RESOLUTIONS]}. Retorno definido pelo sistema demonstrativo.` : feedback.text;
  const uiCommand = useRef(0);
  const [courierRouteId, setCourierRouteId] = useState<string>();
  const [deadlineTarget, setDeadlineTarget] = useState<string>();
  const newDialog = useRef<HTMLDialogElement>(null);
  const courierDialog = useRef<HTMLDialogElement>(null);
  const deadlineDialog = useRef<HTMLDialogElement>(null);
  const issueDialog = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {dispatch({type:"issues-tick",now:seedTime});},[seedTime]);
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
      setNotice("Ação bloqueada. Confira a liberação, a próxima entrega e o motoboy atribuído."); return false;
    }
    dispatch(command);
    setNotice(command.type === "start"
      ? "Início manual simulado pelo motoboy após recolher os pedidos. ON_ROUTE; sequência bloqueada. Tracking e notificações não foram ativados."
      : command.type === "delivery-failure" ? "Falha registrada na demonstração. A ocorrência está na Central; siga as demais entregas."
        : command.type === "delivery-complete" ? "Entrega concluída na demonstração. Confira a próxima parada ou confirme o retorno."
        : command.type === "finish" ? "Entregas concluídas na simulação. Motoboy retornando, ainda fora da fila."
        : "Retorno confirmado na simulação. Motoboy no final da fila de disponíveis.");
    if (command.type === "start" && command.routeId === editingId) cancel();
    return true;
  }
  function issueCommand(command: Command) {
    const next = operationsReducer(state,command);
    if(next===state){setNotice("A ocorrência ou a rota mudou. Confira o estado atual na Central.");return false;}
    dispatch(command);
    if(command.type==="issue-decide") {
      const issue=next.issues.find(i=>i.id===command.issueId)!;
      setNotice(`${RESOLUTIONS[issue.resolution!]}. Visão do motoboy atualizada na demonstração.`);
      return issue.resolution===command.decision;
    }
    if(command.type==="alert-dismiss")setNotice("Aviso fechado. Decisões e histórico permanecem na Central.");
    if(command.type==="issue-timeout-config")setNotice("Tempo de resposta atualizado para novas ocorrências demonstrativas.");
    if(command.type==="delivery-cancel")setNotice("Entrega cancelada pela loja. Pedido visível como cancelado; sequência original preservada.");
    return true;
  }
  function viewedAlerts(ids: string[]) {
    dispatch({type:"alert-view",issueIds:ids,actorId:DEMO_STORE_ACTOR,now:Date.now(),commandId:`ui:view:${uiCommand.current++}`});
  }
  function dismissAlerts(ids: string[]) {
    issueCommand({type:"alert-dismiss",issueIds:ids,actorId:DEMO_STORE_ACTOR,now:Date.now(),commandId:`ui:dismiss:${uiCommand.current++}`});
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
    newDialog, courierDialog, deadlineDialog, issueDialog, tabRefs,
    assign, acceptAutomatic, edit, add, openNewOrder, cancel, release, revokeRelease, saveDeadline, courierCommand, issueCommand, viewedAlerts, dismissAlerts, tabKey };
}
