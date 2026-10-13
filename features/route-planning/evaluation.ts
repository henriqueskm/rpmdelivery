import { estimateSequence } from "../route-optimization/optimize.ts";
import { isConfirmed } from "../route-optimization/types.ts";
import { planningBatch, planningCouriers, routeInput, validatePlanning } from "./input.ts";
import { parametersOf, PlanningError, type Plan, type PlannedGroup, type PlannedRoute, type PlanningInput, type PendingReason, type PendingOrder } from "./types.ts";

export function pendingRisk(input: PlanningInput, routes: PlannedRoute[]) {
  const used=new Set(routes.flatMap(r=>r.ids)), waiting=input.orders.filter(o=>o.delivery==="WAITING"&&!used.has(o.id));
  const nextDeparture=routes.length < planningCouriers(input).length ? input.departureAt
    : routes.length ? Math.min(...routes.map(r=>r.estimate.returnAt)) : input.departureAt;
  let overdue=0,tight=0,lowerBoundLate=0,unestimated=0,lateSeconds=0,unknownOverdue=0;
  const home=input.matrix.pointIds.indexOf(input.restaurant.id);
  for (const o of waiting) {
    if(o.deadlineAt<=input.departureAt) overdue++;
    else if(o.deadlineAt-input.departureAt<300000) tight++;
    const i=input.matrix.pointIds.indexOf(o.id), direct=home<0||i<0 ? null : input.matrix.durations[home][i];
    if(!isConfirmed(o.coordinate)||direct===null) {unestimated++;if(o.deadlineAt<=input.departureAt)unknownOverdue++;continue;}
    const delay=Math.max(0,(nextDeparture+(direct+input.serviceSeconds)*1000-o.deadlineAt)/1000);
    if(delay>0) {lowerBoundLate++;lateSeconds+=delay;}
  }
  return {overdue,tight,lowerBoundLate,unestimated,lateSeconds,unknownOverdue};
}
// Pending orders participate; their direct-arrival bound is optimistic, never a promised ETA.
export function planScore(input: PlanningInput, routes: PlannedRoute[]) {
  const pending=pendingRisk(input,routes);
  return [routes.reduce((n,r)=>n+r.estimate.lateCount,0)+pending.lowerBoundLate+pending.unknownOverdue,
    routes.reduce((n,r)=>n+r.estimate.lateSeconds,0)+pending.lateSeconds,
    pending.tight, input.orders.filter(o=>o.delivery==="WAITING").length-routes.reduce((n,r)=>n+r.ids.length,0),
    routes.reduce((n,r)=>n+r.estimate.travelSeconds,0),routes.reduce((n,r)=>n+r.estimate.distanceMeters,0)];
}
export function comparePlans(a: number[], b: number[]) {
  for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return a[i]-b[i];
  return 0;
}
export function summarize(input: PlanningInput, routes: PlannedRoute[], reasons: Map<string,PendingReason>, stats={exactCalls:0,permutations:0,budgetLimited:false}): Plan {
  const batch=planningBatch(input.orders), analyzed=new Set(batch.map(o=>o.id)), used=new Set(routes.flatMap(r=>r.ids));
  const waiting=input.orders.filter(o=>o.delivery==="WAITING"), risk=pendingRisk(input,routes);
  return {routes,waitingCount:waiting.length,assignedCount:used.size,analyzedIds:[...analyzed],
    pending:waiting.filter(o=>!used.has(o.id)).map(o=>({id:o.id,reason:!isConfirmed(o.coordinate)?"coordinates":
      !analyzed.has(o.id)?"batch":reasons.get(o.id)??"capacity"})),
    lateCount:routes.reduce((n,r)=>n+r.estimate.lateCount,0),
    tightCount:routes.flatMap(r=>r.estimate.stops).filter(s=>s.lateSeconds===0&&s.deadlineAt-s.completedAt<300000).length,
    pendingOverdue:risk.overdue,pendingTight:risk.tight,pendingLowerBoundLate:risk.lowerBoundLate,pendingUnestimated:risk.unestimated,
    ...stats,parameters:parametersOf(input)};
}
export function reviewGroups(input: PlanningInput, groups: PlannedGroup[], previousPending: PendingOrder[] = []) {
  validatePlanning(input);
  const batch=new Set(planningBatch(input.orders).map(o=>o.id)), couriers=new Set(planningCouriers(input).map(c=>c.id));
  const ids=groups.flatMap(g=>g.ids);
  if(groups.length>couriers.size||new Set(groups.map(g=>g.courierId)).size!==groups.length||
    new Set(ids).size!==ids.length||groups.some(g=>!couriers.has(g.courierId)||!g.ids.length||g.ids.length>input.capacity||g.ids.some(id=>!batch.has(id))))
    throw new PlanningError("invalid");
  const routes=groups.map(g=>{
    const estimate=estimateSequence(routeInput(input,g.ids),g.ids);
    if(!estimate||estimate.durationSeconds>input.maxRouteSeconds) throw new PlanningError("invalid");
    return {...g,ids:[...g.ids],estimate};
  });
  const intrinsic=new Map(previousPending.filter(p=>p.reason==="no-route"||p.reason==="long-route").map(p=>[p.id,p.reason]));
  return summarize(input,routes,new Map(planningBatch(input.orders).map(o=>[o.id,intrinsic.get(o.id)??"adjusted"])));
}
