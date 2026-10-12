import { deadlineAt } from "./deadlines.ts";
import { editableOrders, type DemoState } from "./model.ts";
import { fixtureMatrix } from "../route-optimization/fixtures.ts";
import { MAX_STOPS, OptimizationError, isConfirmed, type OptimizationInput } from "../route-optimization/types.ts";

export function proposalSignature(state: DemoState, ids: string[], editingId?: string) {
  return JSON.stringify([state.restaurantLocation, ids.map(id => state.orders.find(o => o.id === id)),
    editingId, state.routes.find(r => r.id === editingId)?.status]);
}
export function demoOptimizationInput(state: DemoState, ids: string[], editingId: string | undefined,
  scenario: string, departureAt: number, serviceSeconds: number): OptimizationInput {
  if (!ids.length || ids.length > MAX_STOPS) throw new OptimizationError("limit");
  const route = state.routes.find(r => r.id === editingId);
  if ((editingId && !route) || (route && route.status !== "PREPARING")) throw new OptimizationError("phase");
  const eligible = editableOrders(state, editingId);
  if (new Set(ids).size !== ids.length || ids.some(id => !eligible.some(o => o.id === id)))
    throw new OptimizationError("invalid");
  const orders = ids.map(id => state.orders.find(o => o.id === id)!);
  if (!isConfirmed(state.restaurantLocation) || orders.some(o => !isConfirmed(o.location))) throw new OptimizationError("coordinates");
  if (state.restaurantLocation.source !== "fixture" || orders.some(o => o.location?.source !== "fixture"))
    throw new OptimizationError("unavailable");
  if (scenario === "opt-unavailable") throw new OptimizationError("unavailable");
  const restaurant = { id: "demo-restaurant", coordinate: state.restaurantLocation };
  const stops = orders.map(o => ({ id: o.id, coordinate: o.location!, deadlineAt: deadlineAt(o) }));
  return { restaurant, orders: stops, departureAt, serviceSeconds, phase: route ? route.status : "DRAFT",
    matrix: fixtureMatrix([restaurant, ...stops], scenario) };
}
