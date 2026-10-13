import { isConfirmed, OptimizationError, type OptimizationInput } from "../route-optimization/types.ts";
import { validateMatrix } from "../route-optimization/validation.ts";
import { BATCH_LIMIT, COURIER_LIMIT, PlanningError, validParameters, type PlanningInput, type PlanningOrder } from "./types.ts";

const byId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function planningBatch(orders: PlanningOrder[]) {
  return orders.filter(o => o.delivery === "WAITING")
    .sort((a,b) => a.deadlineAt-b.deadlineAt || byId(a.id,b.id)).slice(0,BATCH_LIMIT);
}
export function planningCouriers(input: PlanningInput) {
  return input.couriers.filter(c => c.eligible).sort((a,b) => a.queueOrder-b.queueOrder || byId(a.id,b.id))
    .slice(0,COURIER_LIMIT);
}
export function validatePlanning(input: PlanningInput) {
  if (!validParameters(input) || input.orders.length > 10000 || input.couriers.length > 1000 ||
    input.orders.some(o => !o.id.trim() || o.id.length > 160 || !Number.isSafeInteger(o.deadlineAt) || o.deadlineAt <= 0 || o.deadlineAt > 8e15) ||
    new Set(input.orders.map(o => o.id)).size !== input.orders.length ||
    input.couriers.some(c => !c.id.trim() || !Number.isFinite(c.queueOrder) || typeof c.eligible !== "boolean") ||
    new Set(input.couriers.map(c => c.id)).size !== input.couriers.length) throw new PlanningError("invalid");
  if (!isConfirmed(input.restaurant.coordinate) || !input.restaurant.id.trim() ||
    input.orders.some(o => o.id === input.restaurant.id)) throw new PlanningError("coordinates");
  const points = [input.restaurant, ...planningBatch(input.orders).filter(o => isConfirmed(o.coordinate))
    .map(o => ({id:o.id,coordinate:o.coordinate!}))];
  // Empty/all-missing batches do not need a matrix; no invented edges.
  if (points.length === 1) return;
  try {
    validateMatrix(input.matrix,BATCH_LIMIT+1);
    if (input.matrix.pointIds.length !== points.length || points.some(p => {
      const i=input.matrix.pointIds.indexOf(p.id), c=input.matrix.coordinates[i];
      return !c || c.latitude!==p.coordinate.latitude || c.longitude!==p.coordinate.longitude;
    })) throw new PlanningError("matrix");
  } catch { throw new PlanningError("matrix"); }
}
export function routeInput(input: PlanningInput, ids: string[]): OptimizationInput {
  const points = [input.restaurant, ...ids.map(id => {
    const order=input.orders.find(o => o.id===id);
    if (!order || order.delivery!=="WAITING" || !isConfirmed(order.coordinate)) throw new OptimizationError("coordinates");
    return {id,coordinate:order.coordinate,deadlineAt:order.deadlineAt};
  })];
  const indices=points.map(p => input.matrix.pointIds.indexOf(p.id));
  if (indices.some(i => i<0)) throw new OptimizationError("matrix");
  return {restaurant:input.restaurant,orders:points.slice(1) as OptimizationInput["orders"],
    phase:"DRAFT",departureAt:input.departureAt,serviceSeconds:input.serviceSeconds,
    matrix:{source:input.matrix.source,pointIds:points.map(p=>p.id),coordinates:points.map(p=>p.coordinate),
      durations:indices.map(i=>indices.map(j=>input.matrix.durations[i][j])),
      distances:indices.map(i=>indices.map(j=>input.matrix.distances[i][j]))}};
}
