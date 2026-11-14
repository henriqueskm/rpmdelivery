import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { createDemoState, type Scenario } from "./fixtures";
import { availableCouriers, operationsReducer, type Command, type NewOrder } from "./model";
import { localDateTime } from "./deadlines";
import type { AssignmentProposal } from "./automatic-assignment";
import type { PlannedGroup, PlanningParameters } from "../route-planning/types";
import { DEMO_STORE_ACTOR, type AlertReceipt } from "./issue-types";
import { RESOLUTIONS } from "./issue-presentation";
import { getSupabase } from "@/lib/supabase/client";
import { boardToState, type Board } from "./live/board";
import { errorMessage, rpcFor, type StoreCommand } from "./live/commands";

export const tabs = [
  { id: "orders", label: "Pedidos" }, { id: "builder", label: "Montagem" },
  { id: "couriers", label: "Motoboys" }, { id: "routes", label: "Rotas" },
] as const;
type Tab = (typeof tabs)[number]["id"];

/** Real data: the board read from Supabase and how to read it again. */
export type LiveSource = { restaurantId: string; board: Board; receivedAt: number; refresh: () => Promise<void> };

// Alert receipts (seen / dismissed) are per device, like the sound toggle.
const receiptsKey = (restaurantId: string) => `rpm:alert-receipts:${restaurantId}`;
function readReceipts(restaurantId?: string): Record<string, AlertReceipt> {
  if (!restaurantId) return {};
  try { return JSON.parse(window.localStorage.getItem(receiptsKey(restaurantId)) ?? "{}"); } catch { return {}; }
}
function saveReceipts(restaurantId: string, receipts: Record<string, AlertReceipt>) {
  try { window.localStorage.setItem(receiptsKey(restaurantId), JSON.stringify(receipts)); } catch { /* private mode */ }
}

export function useOperationsController(scenario: Scenario, seedTime: number, live?: LiveSource) {
  const [demoState, dispatch] = useReducer(operationsReducer, scenario, s => createDemoState(s, seedTime));
  const [receipts, setReceipts] = useState(() => readReceipts(live?.restaurantId));
  const liveBoard = useMemo(() => live && boardToState(live.board, { now: seedTime, receivedAt: live.receivedAt, alertReceipts: receipts }),
    [live, seedTime, receipts]);
  const state = liveBoard?.state ?? demoState;
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
  // A retry of the same creation after a network failure reuses its request id,
  // so the server answers with what it already created instead of a duplicate.
  const requestIds = useRef(new Map<string, string>());
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {dispatch({type:"issues-tick",now:seedTime});},[seedTime]);

  /** Applies a validated command: in memory for the demo, through the RPC for real data. */
  async function run(command: Command | StoreCommand): Promise<boolean> {
    if (!live || !liveBoard) { dispatch(command as Command); return true; }
    if (command.type === "alert-view" || command.type === "alert-dismiss") {
      const next = operationsReducer(state, command).alertReceipts;
      setReceipts(next); saveReceipts(live.restaurantId, next);
      return true;
    }
    if (busy.current) { setNotice("Aguarde: a ação anterior ainda está sendo salva."); return false; }
    const key = command.type === "add" ? `add:${JSON.stringify(command.order)}`
      : command.type === "assign" && !command.editingId ? `route:${command.courierId}:${command.ids.join(",")}` : "";
    const requestId = (key && requestIds.current.get(key)) || crypto.randomUUID();
    if (key) requestIds.current.set(key, requestId);
    busy.current = true; setPending(true);
    try {
      const call = rpcFor(command, live.restaurantId, liveBoard, requestId);
      if (!call) return false;
      // The command name comes from rpcFor; its arguments were built for that RPC.
      const { error } = await getSupabase().rpc(call.fn as never, call.args as never);
      if (error) { setNotice(errorMessage(error)); await live.refresh(); return false; }
      if (key) requestIds.current.delete(key);
      await live.refresh();
      return true;
    } catch {
      setNotice(errorMessage(null));
      return false;
    } finally {
      busy.current = false; setPending(false);
    }
  }

  function showArea(tab: Tab) {
    setActiveTab(tab);
    if (window.matchMedia("(max-width: 1099px)").matches)
      tabRefs.current[tabs.findIndex(t => t.id === tab)]?.focus();
  }
  function cancel() { setSelected([]); setEditingId(undefined); setCourierId(""); }
  async function assign() {
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
    if (!(await run(command))) return;
    setNotice(editingId
      ? previous?.pickupReleasedAt && updated?.pickupReleasedAt === null
        ? "Pedidos alterados. Retirada voltou a Aguardando liberação; libere todos novamente."
        : updated?.pickupReleasedAt ? "Sequência atualizada. Liberação de retirada preservada."
          : "Montagem atualizada. Aguardando liberação da loja e início manual pelo motoboy."
      : live ? "Rota em preparação. Motoboy reservado; aguardando a loja liberar a retirada."
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
  async function add(order: NewOrder) {
    const command: Command = { type: "add", order, now: Date.now() };
    if (operationsReducer(state, command) === state) return false;
    if (!(await run(command))) return false;
    setActiveTab("orders");
    setNotice(live ? "Pedido cadastrado. Aguardando despacho."
      : "Pedido fictício cadastrado. Aguardando despacho; disponível somente nesta sessão da página.");
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
  async function release(id: string) {
    const route = state.routes.find(r => r.id === id);
    if (!route) return;
    const command: Command = { type: "release", routeId: id, expectedOrderIds: [...route.orderIds], now: Date.now() };
    if (operationsReducer(state, command) === state) {
      setNotice("A rota mudou ou não pode ser liberada. Confira sua montagem atual."); return;
    }
    if (!(await run(command))) return;
    setNotice(live ? `Todos os ${route.orderIds.length} pedidos de ${route.reference} liberados juntos. Só o motoboy inicia a rota.`
      : `Todos os ${route.orderIds.length} pedidos de ${route.reference} liberados juntos. PREPARING; início exclusivo pelo motoboy, sem tracking ou notificações.`);
  }
  function saveDeadline(command: Command) {
    if (operationsReducer(state, command) === state) return false;
    dispatch(command);
    setNotice(command.type === "default-promise" ? "Prazo padrão atualizado só para novos pedidos nesta demonstração."
      : "Prazo prometido atualizado. Sequência preservada; isto não prevê a chegada.");
    return true;
  }
  async function revokeRelease(id: string) {
    const command: Command = { type: "revoke-release", routeId: id };
    if (operationsReducer(state, command) === state) {
      setNotice("Não foi possível cancelar a liberação. A rota precisa estar em preparação e já liberada."); return;
    }
    if (!(await run(command))) return;
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
  async function issueCommand(command: Command) {
    const next = operationsReducer(state,command);
    if(next===state){setNotice("A ocorrência ou a rota mudou. Confira o estado atual na Central.");return false;}
    if(!(await run(command)))return false;
    if(command.type==="issue-decide") {
      if (live) { setNotice(`${RESOLUTIONS[command.decision]}.`); return true; }
      const issue=next.issues.find(i=>i.id===command.issueId)!;
      setNotice(`${RESOLUTIONS[issue.resolution!]}. Visão do motoboy atualizada na demonstração.`);
      return issue.resolution===command.decision;
    }
    if(command.type==="alert-dismiss")setNotice("Aviso fechado. Decisões e histórico permanecem na Central.");
    if(command.type==="issue-timeout-config")setNotice("Tempo de resposta atualizado para novas ocorrências demonstrativas.");
    if(command.type==="delivery-cancel")setNotice("Entrega cancelada pela loja. Pedido visível como cancelado; sequência original preservada.");
    return true;
  }
  async function reviewShift(shiftId: string, approve: boolean) {
    const courier = state.couriers.find(c => c.id === shiftId && c.shift === "PENDING");
    if (!courier) return;
    if (!(await run({ type: "review-shift", shiftId, approve }))) return;
    setNotice(approve ? `Turno de ${courier.name} aprovado. Entrou no fim da fila de disponíveis.`
      : `Turno de ${courier.name} recusado.`);
  }
  function viewedAlerts(ids: string[]) {
    void run({type:"alert-view",issueIds:ids,actorId:DEMO_STORE_ACTOR,now:Date.now(),commandId:`ui:view:${uiCommand.current++}`});
  }
  function dismissAlerts(ids: string[]) {
    void issueCommand({type:"alert-dismiss",issueIds:ids,actorId:DEMO_STORE_ACTOR,now:Date.now(),commandId:`ui:dismiss:${uiCommand.current++}`});
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
    newDialog, courierDialog, deadlineDialog, issueDialog, tabRefs, pending,
    assign, acceptAutomatic, edit, add, openNewOrder, cancel, release, revokeRelease, saveDeadline, courierCommand, issueCommand,
    reviewShift, viewedAlerts, dismissAlerts, tabKey };
}
