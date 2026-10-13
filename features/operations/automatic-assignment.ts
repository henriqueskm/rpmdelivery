import { isConfirmed } from "../route-optimization/types.ts";
import { parametersOf, validParameters, type Plan, type PlannedGroup, type PlanningParameters } from "../route-planning/types.ts";
import type { DemoState } from "./model.ts";

export type AssignmentProposal = { snapshot: string; plan: Plan };
export function automaticSnapshot(state: DemoState) { return JSON.stringify(state); }
export function validAutomaticAssignment(state: DemoState, proposal: AssignmentProposal,
  groups: PlannedGroup[], parameters: PlanningParameters, now: number, eligibleIds: string[]) {
  if(!validParameters(parameters)||parameters.departureAt<now||!Number.isSafeInteger(now)||now<=0||
    proposal.snapshot!==automaticSnapshot(state)||JSON.stringify(parametersOf(proposal.plan.parameters))!==JSON.stringify(parametersOf(parameters))||
    !groups.length||groups.length>6||new Set(groups.map(g=>g.courierId)).size!==groups.length) return false;
  const ids=groups.flatMap(g=>g.ids), eligible=new Set(eligibleIds);
  if(new Set(ids).size!==ids.length) return false;
  return groups.every(g=>{
    const planned=proposal.plan.routes.find(r=>r.courierId===g.courierId);
    return eligible.has(g.courierId)&&g.ids.length>0&&g.ids.length<=parameters.capacity&&planned&&
      JSON.stringify(planned.ids)===JSON.stringify(g.ids)&&g.ids.every(id=>
        !state.routes.some(r=>r.status!=="COMPLETED"&&r.orderIds.includes(id))&&
        state.orders.some(o=>o.id===id&&o.delivery==="WAITING"&&isConfirmed(o.location)));
  });
}
