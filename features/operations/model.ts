import { validOrderTime, validPromise } from "./deadlines.ts";
import type { ConfirmedCoordinate } from "../route-optimization/types.ts";
import { validAutomaticAssignment, type AssignmentProposal } from "./automatic-assignment.ts";
import type { PlannedGroup, PlanningParameters } from "../route-planning/types.ts";
import type { AlertReceipt, DeliveryStatus, DemoEvent, DemoIssue, IssueCommand } from "./issue-types.ts";
import { deliveryFinal } from "./issue-types.ts";
import { issueReducer } from "./issue-reducer.ts";
import { executeRoute } from "./route-execution.ts";

export type RouteStatus = "PREPARING" | "ON_ROUTE" | "RETURNING" | "COMPLETED";
export type ShiftStatus = "AVAILABLE" | "ON_ROUTE" | "RETURNING" | "PENDING";
export type DemoOrder = {
  id: string;
  reference: string;
  customer: string;
  phone: string;
  address: string;
  neighborhood: string;
  complement: string;
  notes: string;
  location?: ConfirmedCoordinate;
  orderedAt: number;
  createdAt: number;
  promisedMinutes: number;
  status: "OPEN" | "DELIVERING" | "DELIVERED" | "CANCELLED";
  delivery: DeliveryStatus;
  attemptNumber?: number;
};
export type DemoCourier = {
  id: string;
  name: string;
  initials: string;
  shift: ShiftStatus;
  activeLink: boolean;
  queueOrder: number;
  availableMinutes: number;
};
export type DemoRoute = {
  id: string;
  reference: string;
  courierId: string;
  orderIds: string[];
  status: RouteStatus;
  pickupReleasedAt: number | null;
  retryOrderIds?: string[];
};
export type DemoState = {
  issueTimeoutMinutes: number;
  issues: DemoIssue[];
  events: DemoEvent[];
  commandIds: string[];
  alertReceipts: Record<string, AlertReceipt>;
  restaurantLocation?: ConfirmedCoordinate;
  defaultPromiseMinutes: number;
  orders: DemoOrder[];
  couriers: DemoCourier[];
  routes: DemoRoute[];
  nextOrder: number;
  nextRoute: number;
  nextQueue: number;
};
export type NewOrder = Pick<
  DemoOrder,
  | "reference"
  | "customer"
  | "phone"
  | "address"
  | "neighborhood"
  | "complement"
  | "notes"
  | "orderedAt"
  | "promisedMinutes"
>;
export type Command =
  | IssueCommand
  | { type: "batch-assign"; proposal: AssignmentProposal; groups: PlannedGroup[]; parameters: PlanningParameters; now: number }
  | { type: "add"; order: NewOrder; now: number }
  | { type: "default-promise"; minutes: number }
  | { type: "deadline"; orderId: string; orderedAt: number; minutes: number }
  | { type: "release"; routeId: string; expectedOrderIds: string[]; now: number }
  | { type: "revoke-release"; routeId: string }
  | { type: "assign"; ids: string[]; courierId: string; editingId?: string }
  | { type: "start" | "finish" | "arrive"; routeId: string; actorId: string; now?: number };

export function activeRoute(state: DemoState, courierId: string) {
  return state.routes.find(
    (r) => r.courierId === courierId && r.status !== "COMPLETED",
  );
}
export function availableCouriers(state: DemoState) {
  return state.couriers
    .filter(
      (c) =>
        c.activeLink && c.shift === "AVAILABLE" && !activeRoute(state, c.id),
    )
    .sort((a, b) => a.queueOrder - b.queueOrder);
}
export function courierLabel(state: DemoState, courier: DemoCourier) {
  if (activeRoute(state, courier.id)?.status === "PREPARING")
    return "Reservado";
  return {
    AVAILABLE: "Disponível",
    ON_ROUTE: "Em rota",
    RETURNING: "Retornando",
    PENDING: "Turno pendente",
  }[courier.shift];
}
export function editableOrders(state: DemoState, editingId?: string) {
  const route = state.routes.find(
    (r) => r.id === editingId && r.status === "PREPARING",
  );
  return state.orders.filter(
    (o) => o.delivery === "WAITING" || route?.orderIds.includes(o.id),
  );
}
export function plural(count: number, singular: string, multiple: string) {
  return `${new Intl.NumberFormat("pt-BR").format(count)} ${count === 1 ? singular : multiple}`;
}
export function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

// This reducer is an in-memory prototype. It performs no API, storage or backend operation.
export function operationsReducer(
  state: DemoState,
  command: Command,
): DemoState {
  if (["delivery-complete", "delivery-failure", "issue-decide", "delivery-cancel", "issue-timeout-config", "alert-view", "alert-dismiss", "issues-tick"].includes(command.type))
    return issueReducer(state, command as IssueCommand);
  if (command.type === "batch-assign") {
    if (!validAutomaticAssignment(state, command.proposal, command.groups, command.parameters, command.now, availableCouriers(state).map(c=>c.id))) return state;
    let next = state;
    for (const group of command.groups) {
      const assigned = operationsReducer(next, { type: "assign", ids: group.ids, courierId: group.courierId });
      if (assigned === next) return state; // Full rollback: all transitions are immutable.
      next = assigned;
    }
    return next;
  }
  if (command.type === "default-promise") {
    return validPromise(command.minutes) ? { ...state, defaultPromiseMinutes: command.minutes } : state;
  }
  if (command.type === "deadline") {
    const order = state.orders.find(o => o.id === command.orderId && !deliveryFinal(o.delivery));
    if (!order || !validPromise(command.minutes) || !validOrderTime(command.orderedAt, order.createdAt)) return state;
    return { ...state, orders: state.orders.map(o => o.id === order.id
      ? { ...o, orderedAt: command.orderedAt, promisedMinutes: command.minutes } : o) };
  }
  if (command.type === "revoke-release") {
    const route = state.routes.find(r => r.id === command.routeId);
    if (!route || route.status !== "PREPARING" || route.pickupReleasedAt === null) return state;
    return { ...state, routes: state.routes.map(r => r.id === route.id ? { ...r, pickupReleasedAt: null } : r) };
  }
  if (command.type === "release") {
    const route = state.routes.find(r => r.id === command.routeId);
    const courier = state.couriers.find(c => c.id === route?.courierId);
    if (!route || route.status !== "PREPARING" || route.pickupReleasedAt !== null ||
      !courier?.activeLink || courier.shift !== "AVAILABLE" || !route.orderIds.length ||
      !validOrderTime(command.now, command.now) ||
      new Set(command.expectedOrderIds).size !== route.orderIds.length ||
      command.expectedOrderIds.length !== route.orderIds.length ||
      !route.orderIds.every(id => command.expectedOrderIds.includes(id) && state.orders.some(o => o.id === id && o.delivery === "ASSIGNED"))) return state;
    return { ...state, routes: state.routes.map(r => r.id === route.id ? { ...r, pickupReleasedAt: command.now } : r) };
  }
  if (command.type === "add") {
    const order = command.order;
    if (
      !validOrderTime(order.orderedAt, command.now) || !validPromise(order.promisedMinutes) ||
      ![order.customer, order.phone, order.address, order.neighborhood].every(
        (v) => v.trim(),
      )
    )
      return state;
    return {
      ...state,
      nextOrder: state.nextOrder + 1,
      orders: [
        {
          ...order,
          id: `demo-order-${state.nextOrder}`,
          reference: order.reference.trim() || String(state.nextOrder),
          createdAt: command.now,
          status: "OPEN",
          delivery: "WAITING",
        },
        ...state.orders,
      ],
    };
  }
  if (command.type === "assign") {
    const editing = command.editingId
      ? state.routes.find((r) => r.id === command.editingId)
      : undefined;
    if (
      command.editingId &&
      (!editing ||
        editing.status !== "PREPARING" ||
        editing.courierId !== command.courierId)
    )
      return state;
    const courier = state.couriers.find(
      (c) =>
        c.id === command.courierId && c.activeLink && c.shift === "AVAILABLE",
    );
    const occupied = activeRoute(state, command.courierId);
    const allowed = editableOrders(state, command.editingId);
    if (
      !courier ||
      (occupied && occupied.id !== editing?.id) ||
      !command.ids.length ||
      new Set(command.ids).size !== command.ids.length ||
      !command.ids.every((id) => allowed.some((o) => o.id === id))
    )
      return state;
    const route: DemoRoute = {
      id: editing?.id ?? `demo-route-${state.nextRoute}`,
      reference: editing?.reference ?? `R-${state.nextRoute}`,
      courierId: courier.id,
      orderIds: [...command.ids],
      status: "PREPARING",
      pickupReleasedAt: editing && editing.orderIds.length === command.ids.length &&
        editing.orderIds.every(id => command.ids.includes(id)) ? editing.pickupReleasedAt : null,
    };
    return {
      ...state,
      nextRoute: state.nextRoute + (editing ? 0 : 1),
      routes: editing
        ? state.routes.map((r) => (r.id === editing.id ? route : r))
        : [route, ...state.routes],
      orders: state.orders.map((o) =>
        command.ids.includes(o.id)
          ? { ...o, delivery: "ASSIGNED", status: "OPEN" }
          : editing?.orderIds.includes(o.id)
            ? { ...o, delivery: "WAITING", status: "OPEN" }
            : o,
      ),
    };
  }
  return executeRoute(state, command as Extract<Command, {type: "start" | "finish" | "arrive"}>);
}
