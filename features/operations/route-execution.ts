import type { Command, DemoState } from "./model.ts";
import { deliveryFinal, validIssueTime } from "./issue-types.ts";
import { recordEvent } from "./issue-events.ts";
import { progressRoute } from "./route-progress.ts";

type RouteCommand = Extract<Command, {type: "start" | "finish" | "arrive"}>;
export function executeRoute(state: DemoState, command: RouteCommand): DemoState {
  const route = state.routes.find(r => r.id === command.routeId);
  const courier = state.couriers.find(c => c.id === command.actorId && c.activeLink);
  if (!route || !courier || route.courierId !== courier.id) return state;
  const now = command.now ?? Math.max(...state.orders.map(o => o.createdAt), ...state.events.map(e => e.at), route.pickupReleasedAt ?? 0);
  if (!validIssueTime(now) || state.events.some(e => e.routeId === route.id && e.at > now)) return state;
  if (command.type === "start") {
    if (route.status !== "PREPARING" || courier.shift !== "AVAILABLE" ||
      !validIssueTime(route.pickupReleasedAt ?? NaN) || now < route.pickupReleasedAt! || !route.orderIds.length ||
      !route.orderIds.every(id => state.orders.some(o => o.id === id && o.delivery === "ASSIGNED"))) return state;
    const next: DemoState = {...state,
      routes: state.routes.map(r => r.id === route.id ? {...r, status: "ON_ROUTE", retryOrderIds: []} : r),
      couriers: state.couriers.map(c => c.id === courier.id ? {...c, shift: "ON_ROUTE"} : c),
      orders: state.orders.map(o => route.orderIds.includes(o.id) ? {...o, status: "DELIVERING", delivery: "ON_ROUTE", attemptNumber: 1} : o),
    };
    return progressRoute(recordEvent(next, {id: `${route.id}:started`, type: "ROUTE_STARTED", at: now,
      actorId: courier.id, actorType: "COURIER", routeId: route.id}), route.id, now, `${route.id}:started`);
  }
  if (command.type === "finish") {
    // Legacy command may request return, but can never mark unexecuted deliveries completed.
    if (route.status !== "ON_ROUTE" || courier.shift !== "ON_ROUTE" ||
      !route.orderIds.every(id => state.orders.some(o => o.id === id && deliveryFinal(o.delivery)))) return state;
    return progressRoute(state, route.id, now, `${route.id}:finished`);
  }
  if (route.status !== "RETURNING" || courier.shift !== "RETURNING" ||
    !route.orderIds.every(id => state.orders.some(o => o.id === id && deliveryFinal(o.delivery)))) return state;
  const next: DemoState = {...state, nextQueue: state.nextQueue + 1,
    routes: state.routes.map(r => r.id === route.id ? {...r, status: "COMPLETED"} : r),
    couriers: state.couriers.map(c => c.id === courier.id ? {...c, shift: "AVAILABLE", queueOrder: state.nextQueue, availableMinutes: 0} : c),
  };
  return recordEvent(next, {id: `${route.id}:arrived`, type: "COURIER_ARRIVED", at: now,
    actorId: courier.id, actorType: "COURIER", routeId: route.id});
}
