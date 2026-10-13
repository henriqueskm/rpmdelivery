import type { DemoOrder, DemoRoute, DemoState } from "./model.ts";
import { deliveryEligible, deliveryFinal } from "./issue-types.ts";
import { closeIssue, recordEvent } from "./issue-events.ts";

// Execution queue is separate from immutable planned orderIds. Retries follow remaining first attempts.
export function nextDelivery(state: DemoState, route: DemoRoute): DemoOrder | undefined {
  const orders = new Map(state.orders.map(o => [o.id, o]));
  const retries = new Set(route.retryOrderIds ?? []);
  const eligible = route.orderIds.map(id => orders.get(id)).filter((o): o is DemoOrder => !!o && deliveryEligible(o.delivery));
  const firstAttempts = eligible.filter(o => !retries.has(o.id));
  return firstAttempts.find(o => o.delivery === "NEXT") ?? firstAttempts[0]
    ?? (route.retryOrderIds ?? []).map(id => orders.get(id)).find(o => o && deliveryEligible(o.delivery));
}
export function progressRoute(state: DemoState, routeId: string, now: number, cause: string): DemoState {
  const route = state.routes.find(r => r.id === routeId && r.status === "ON_ROUTE");
  if (!route) return state;
  const next = nextDelivery(state, route);
  if (next) {
    if (next.delivery === "NEXT" && !state.orders.some(o => route.orderIds.includes(o.id) && o.id !== next.id && o.delivery === "NEXT")) return state;
    const changed: DemoState = {...state, orders: state.orders.map(o => !route.orderIds.includes(o.id) || !deliveryEligible(o.delivery)
      ? o : {...o, delivery: o.id === next.id ? "NEXT" : "ON_ROUTE"})};
    return recordEvent(changed, {id: `${cause}:next:${route.id}:${next.id}`, type: "NEXT_DELIVERY_CHANGED",
      at: now, actorId: "demo-system", actorType: "SYSTEM", routeId: route.id, orderId: next.id});
  }
  let changed = state;
  for (const issue of state.issues.filter(i => i.routeId === route.id && i.status === "PENDING"))
    changed = closeIssue(changed, issue, "OTHERS_FINISHED", "demo-system", now, `${issue.id}:others-finished`);
  const orders = new Map(changed.orders.map(o => [o.id, o]));
  if (!route.orderIds.length || !route.orderIds.every(id => {const o = orders.get(id);return o && deliveryFinal(o.delivery);})) return changed;
  changed = {...changed,
    routes: changed.routes.map(r => r.id === route.id ? {...r, status: "RETURNING"} : r),
    couriers: changed.couriers.map(c => c.id === route.courierId ? {...c, shift: "RETURNING"} : c),
  };
  return recordEvent(changed, {id: `${cause}:returning:${route.id}`, type: "ROUTE_RETURNING", at: now,
    actorId: "demo-system", actorType: "SYSTEM", routeId: route.id});
}
export function settleIssues(state: DemoState, now: number): DemoState {
  let next = state;
  const pending = state.issues.filter(i => i.status === "PENDING").sort((a,b) => a.decisionDeadline-b.decisionDeadline || a.reportedAt-b.reportedAt || a.id.localeCompare(b.id));
  for (const issue of pending) if (now >= issue.decisionDeadline)
    next = closeIssue(next, issue, "TIMEOUT", "demo-system", now, `${issue.id}:timeout`);
  for (const routeId of new Set(pending.map(i => i.routeId))) next = progressRoute(next, routeId, now, `tick:${now}`);
  return next;
}
