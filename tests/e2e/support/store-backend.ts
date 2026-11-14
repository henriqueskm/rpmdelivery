import type { RpcHandler, RpcReply } from "./supabase";

// In-memory stand-in for the store RPCs, following the database rules the
// panel depends on. Synthetic data only; nothing reaches Supabase.

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const minutesAhead = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

type Order = {
  deliveryId: string; orderId: string; reference: string; customer: string; phone: string; address: string;
  neighborhood: string | null; complement: string | null; notes: string | null; orderedAt: string; createdAt: string;
  promisedMinutes: number; orderStatus: string; deliveryStatus: string; failedAttempts: number;
};
const order = (reference: string, customer: string, neighborhood: string, deliveryStatus = "WAITING", orderStatus = "OPEN"): Order => ({
  deliveryId: `d-${reference}`, orderId: `o-${reference}`, reference, customer, phone: "+5511987650000",
  address: `Rua Sintética, ${reference}`, neighborhood, complement: null, notes: null,
  orderedAt: minutesAgo(20), createdAt: minutesAgo(19), promisedMinutes: 60, orderStatus, deliveryStatus, failedAttempts: 0,
});

export function storeBackend() {
  // Courier pay of the day: R$ 30 encosta, R$ 7 per delivery.
  const pay = {
    shiftFeeCents: 3000, deliveryFeeCents: 700, canEdit: true,
    couriers: [
      { name: "Ana Souza", deliveries: 3, shiftFeeCents: 3000, deliveryFeesCents: 2100, totalCents: 5100 },
      { name: "Maria Aparecida dos Santos Albuquerque de Vasconcelos", deliveries: 1, shiftFeeCents: 3000, deliveryFeesCents: 700, totalCents: 3700 },
    ],
  };
  const board = {
    restaurant: { defaultPromiseMinutes: 60, issueTimeoutMinutes: 10 },
    couriers: [
      { shiftId: "s-ana", name: "Ana Souza", status: "ON_ROUTE", linkActive: true, requestedAt: minutesAgo(90), availableSince: minutesAgo(60) },
      { shiftId: "s-dani", name: "Dani Lima", status: "AVAILABLE", linkActive: true, requestedAt: minutesAgo(80), availableSince: minutesAgo(40) },
      { shiftId: "s-bruno", name: "Bruno Alves", status: "AVAILABLE", linkActive: true, requestedAt: minutesAgo(70), availableSince: minutesAgo(15) },
      { shiftId: "s-carla", name: "Carla Dias", status: "PENDING", linkActive: true, requestedAt: minutesAgo(2), availableSince: null as string | null },
    ],
    routes: [
      { id: "r-7", reference: "R-7", shiftId: "s-ana", status: "ON_ROUTE", compositionVersion: 1,
        pickupReleasedAt: minutesAgo(30), deliveryIds: ["d-1050", "d-1051"], retryDeliveryIds: [] as string[] },
      { id: "r-6", reference: "R-6", shiftId: "s-dani", status: "PREPARING", compositionVersion: 2,
        pickupReleasedAt: null as string | null, deliveryIds: ["d-1047"], retryDeliveryIds: [] as string[] },
    ],
    orders: [
      order("1048", "Helena Prado", "Bela Vista"),
      order("1049", "Igor Nunes", "Consolação"),
      { ...order("1050", "Júlia Reis", "Liberdade", "ATTEMPT_FAILED", "DELIVERING"), failedAttempts: 1 },
      order("1051", "Kauã Melo", "Aclimação", "NEXT", "DELIVERING"),
      order("1047", "Lara Costa", "Paraíso", "ASSIGNED"),
    ],
    issues: [
      { id: "a-1050", deliveryId: "d-1050", routeId: "r-7", attempt: 1, reason: "CUSTOMER_NOT_RESPONDING",
        notes: "Toquei três vezes", reportedAt: minutesAgo(2), decisionDeadline: minutesAhead(8),
        decision: null as string | null, decidedAt: null as string | null, decidedBy: null as string | null },
    ],
  };
  const calls: { fn: string; body: Record<string, unknown> }[] = [];
  const failures = new Map<string, RpcReply>();
  let offline = false;
  let nextRoute = 8;

  const ok = (json: unknown = {}): RpcReply => ({ json });
  const find = <T extends { [k: string]: unknown }>(items: T[], key: keyof T, value: unknown) => items.find(item => item[key] === value);

  const commands: Record<string, (body: Record<string, unknown>) => RpcReply> = {
    review_shift(body) {
      const shift = find(board.couriers, "shiftId", body.p_shift_id)!;
      shift.status = body.p_approve ? "AVAILABLE" : "REJECTED";
      if (body.p_approve) shift.availableSince = new Date().toISOString();
      else board.couriers.splice(board.couriers.indexOf(shift), 1);
      return ok(shift.status);
    },
    create_order(body) {
      const reference = String(body.p_reference ?? 2000 + board.orders.length);
      const created = { ...order(reference, String(body.p_customer_name), String(body.p_neighborhood ?? "")),
        phone: String(body.p_customer_phone), address: String(body.p_delivery_address),
        orderedAt: String(body.p_ordered_at), createdAt: new Date().toISOString(), promisedMinutes: Number(body.p_promised_minutes) };
      board.orders.unshift(created);
      return ok({ orderId: created.orderId, deliveryId: created.deliveryId, created: true });
    },
    create_route(body) {
      const ids = body.p_delivery_ids as string[];
      if (ids.some(id => find(board.orders, "deliveryId", id)?.deliveryStatus !== "WAITING"))
        return { status: 400, json: { code: "P0001", message: "RPM_DELIVERY_UNAVAILABLE" } };
      const id = `r-${nextRoute}`;
      board.routes.unshift({ id, reference: `R-${nextRoute++}`, shiftId: String(body.p_shift_id), status: "PREPARING",
        compositionVersion: 1, pickupReleasedAt: null, deliveryIds: ids, retryDeliveryIds: [] });
      ids.forEach(deliveryId => { find(board.orders, "deliveryId", deliveryId)!.deliveryStatus = "ASSIGNED"; });
      return ok({ routeId: id });
    },
    release_route_pickup(body) {
      const route = find(board.routes, "id", body.p_route_id)!;
      if (route.compositionVersion !== body.p_expected_version)
        return { status: 400, json: { code: "P0001", message: "RPM_ROUTE_STALE" } };
      route.pickupReleasedAt = new Date().toISOString();
      return ok({ routeId: route.id });
    },
    revoke_route_pickup(body) {
      find(board.routes, "id", body.p_route_id)!.pickupReleasedAt = null;
      return ok({ routeId: body.p_route_id });
    },
    decide_delivery_failure(body) {
      const issue = board.issues.find(item => item.deliveryId === body.p_delivery_id && item.decision === null);
      if (!issue) return { status: 400, json: { code: "P0001", message: "RPM_ISSUE_CLOSED" } };
      Object.assign(issue, { decision: body.p_decision, decidedAt: new Date().toISOString(), decidedBy: "11111111-1111-4111-8111-111111111111" });
      const delivery = find(board.orders, "deliveryId", issue.deliveryId)!;
      if (body.p_decision === "RETRY") {
        delivery.deliveryStatus = "ON_ROUTE";
        find(board.routes, "id", issue.routeId)!.retryDeliveryIds.push(issue.deliveryId);
      } else delivery.deliveryStatus = body.p_decision === "CANCEL" ? "CANCELLED" : "RETURN_TO_STORE";
      return ok({ deliveryId: issue.deliveryId });
    },
    cancel_delivery_on_route(body) {
      find(board.orders, "deliveryId", body.p_delivery_id)!.deliveryStatus = "CANCELLED";
      return ok({ deliveryId: body.p_delivery_id });
    },
    get_courier_pay(body) {
      return ok({ day: body.p_day ?? new Date().toISOString().slice(0, 10), ...structuredClone(pay) });
    },
    set_courier_pay(body) {
      if (!pay.canEdit) return { status: 403, json: { code: "42501", message: "RPM_MANAGER_REQUIRED" } };
      pay.shiftFeeCents = Number(body.p_shift_fee_cents);
      pay.deliveryFeeCents = Number(body.p_delivery_fee_cents);
      return ok({ shiftFeeCents: pay.shiftFeeCents, deliveryFeeCents: pay.deliveryFeeCents });
    },
  };

  const handlers: Record<string, RpcHandler> = {
    get_operations_board: body => {
      calls.push({ fn: "get_operations_board", body });
      return offline ? "abort" : ok({ ...structuredClone(board), serverNow: new Date().toISOString() });
    },
  };
  for (const [fn, run] of Object.entries(commands)) {
    handlers[fn] = body => {
      calls.push({ fn, body });
      const failure = failures.get(fn);
      if (failure) { failures.delete(fn); return failure; }
      return run(body);
    };
  }

  return {
    board, calls, handlers, pay,
    /** The next call of `fn` answers this instead (e.g. a stale version). */
    failOnce(fn: string, reply: RpcReply) { failures.set(fn, reply); },
    setOffline(value: boolean) { offline = value; },
    commandCalls: () => calls.filter(call => call.fn !== "get_operations_board"),
    boardReads: () => calls.filter(call => call.fn === "get_operations_board").length,
  };
}
