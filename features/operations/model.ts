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
  waitMinutes: number;
  status: "OPEN" | "DELIVERING" | "DELIVERED";
  delivery:
    "WAITING" | "ASSIGNED" | "ON_ROUTE" | "ATTEMPT_FAILED" | "DELIVERED";
  issue?: string;
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
};
export type DemoState = {
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
>;
export type Command =
  | { type: "add"; order: NewOrder }
  | { type: "assign"; ids: string[]; courierId: string; editingId?: string }
  | { type: "start" | "finish" | "arrive"; routeId: string; actorId: string };

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
  if (command.type === "add") {
    const order = command.order;
    if (
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
          waitMinutes: 0,
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
  const route = state.routes.find((r) => r.id === command.routeId);
  const courier = state.couriers.find(
    (c) => c.id === command.actorId && c.activeLink,
  );
  if (!route || !courier || route.courierId !== courier.id) return state;
  let status: RouteStatus;
  let shift: ShiftStatus;
  if (command.type === "start") {
    if (
      route.status !== "PREPARING" ||
      courier.shift !== "AVAILABLE" ||
      !route.orderIds.length
    )
      return state;
    status = "ON_ROUTE";
    shift = "ON_ROUTE";
  } else if (command.type === "finish") {
    if (
      route.status !== "ON_ROUTE" ||
      courier.shift !== "ON_ROUTE" ||
      state.orders.some(
        (o) => route.orderIds.includes(o.id) && o.delivery === "ATTEMPT_FAILED",
      )
    )
      return state;
    status = "RETURNING";
    shift = "RETURNING";
  } else {
    if (route.status !== "RETURNING" || courier.shift !== "RETURNING")
      return state;
    status = "COMPLETED";
    shift = "AVAILABLE";
  }
  return {
    ...state,
    nextQueue: state.nextQueue + (command.type === "arrive" ? 1 : 0),
    routes: state.routes.map((r) => (r.id === route.id ? { ...r, status } : r)),
    couriers: state.couriers.map((c) =>
      c.id === courier.id
        ? {
            ...c,
            shift,
            ...(command.type === "arrive"
              ? { queueOrder: state.nextQueue, availableMinutes: 0 }
              : {}),
          }
        : c,
    ),
    orders: state.orders.map((o) =>
      !route.orderIds.includes(o.id) || command.type === "arrive"
        ? o
        : command.type === "start"
          ? { ...o, status: "DELIVERING", delivery: "ON_ROUTE" }
          : { ...o, status: "DELIVERED", delivery: "DELIVERED" },
    ),
  };
}
