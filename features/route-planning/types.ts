import type { ConfirmedCoordinate, Point, RouteEstimate, TravelMatrix } from "../route-optimization/types.ts";

export const BATCH_LIMIT = 24;
export const COURIER_LIMIT = 6;
export const EXACT_CALL_LIMIT = 80;
export const PERMUTATION_LIMIT = 160_000;
export const PLANNING_TIMEOUT_MS = 5_000;
export type PlanningParameters = {
  departureAt: number; serviceSeconds: number; capacity: number; maxRouteSeconds: number;
};
export type PlanningOrder = {
  id: string; delivery: string; coordinate?: ConfirmedCoordinate; deadlineAt: number;
};
export type PlanningCourier = { id: string; queueOrder: number; eligible: boolean };
export type PlanningInput = PlanningParameters & {
  restaurant: Point; orders: PlanningOrder[]; couriers: PlanningCourier[]; matrix: TravelMatrix;
};
export type PlannedGroup = { courierId: string; ids: string[] };
export type PlannedRoute = PlannedGroup & { estimate: RouteEstimate };
export type PendingReason = "coordinates" | "no-route" | "batch" | "couriers" | "capacity" | "long-route" | "adjusted" | "budget";
export type PendingOrder = { id: string; reason: PendingReason };
export type Plan = {
  routes: PlannedRoute[]; pending: PendingOrder[]; analyzedIds: string[];
  waitingCount: number; assignedCount: number; lateCount: number; tightCount: number;
  pendingOverdue: number; pendingTight: number; pendingLowerBoundLate: number; pendingUnestimated: number;
  exactCalls: number; permutations: number; budgetLimited: boolean; parameters: PlanningParameters;
};
export class PlanningError extends Error {
  code: "invalid" | "matrix" | "coordinates" | "limit" | "budget" | "unavailable";
  constructor(code: PlanningError["code"]) { super(code);this.code=code; }
}
export const parametersOf = (input: PlanningParameters): PlanningParameters => ({
  departureAt: input.departureAt, serviceSeconds: input.serviceSeconds,
  capacity: input.capacity, maxRouteSeconds: input.maxRouteSeconds,
});
export function validParameters(p: PlanningParameters) {
  return Number.isSafeInteger(p.departureAt) && p.departureAt > 0 && p.departureAt < 8e15 &&
    Number.isInteger(p.serviceSeconds) && p.serviceSeconds >= 0 && p.serviceSeconds <= 1800 &&
    Number.isInteger(p.capacity) && p.capacity >= 1 && p.capacity <= 8 &&
    Number.isInteger(p.maxRouteSeconds) && p.maxRouteSeconds >= 60 && p.maxRouteSeconds <= 7200;
}
