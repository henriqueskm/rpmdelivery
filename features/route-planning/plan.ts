import { optimizeSequence } from "../route-optimization/optimize.ts";
import { isConfirmed, OptimizationError, type RouteEstimate } from "../route-optimization/types.ts";
import { planningBatch, planningCouriers, routeInput, validatePlanning } from "./input.ts";
import { comparePlans, planScore, summarize } from "./evaluation.ts";
import { EXACT_CALL_LIMIT, PERMUTATION_LIMIT, type PlanningInput, type PlannedRoute, type PendingReason } from "./types.ts";

const factorial=(n:number):number=>n<2?1:n*factorial(n-1);
export function planRoutes(input: PlanningInput) {
  validatePlanning(input);
  const batch=planningBatch(input.orders), couriers=planningCouriers(input), reasons=new Map<string,PendingReason>();
  const stats={exactCalls:0,permutations:0,budgetLimited:false};
  function optimize(ids:string[]):RouteEstimate|null {
    const cost=factorial(ids.length);
    if(stats.exactCalls>=EXACT_CALL_LIMIT||stats.permutations+cost>PERMUTATION_LIMIT) {stats.budgetLimited=true;return null;}
    stats.exactCalls++;stats.permutations+=cost;
    try {return optimizeSequence(routeInput(input,ids)).suggested;}
    catch(e) {if(e instanceof OptimizationError && e.code==="no-route") return null;throw e;}
  }
  const routes:PlannedRoute[]=[], usable=batch.filter(o=>isConfirmed(o.coordinate));
  const home=input.matrix.pointIds.indexOf(input.restaurant.id);
  const index=(id:string)=>input.matrix.pointIds.indexOf(id);
  const direct=(id:string)=>input.matrix.durations[home][index(id)];
  const slack=(id:string)=>input.orders.find(o=>o.id===id)!.deadlineAt-input.departureAt-((direct(id)??0)+input.serviceSeconds)*1000;
  const remaining:string[]=[], singles=new Map<string,RouteEstimate>();
  for(const order of usable) {
    const estimate=optimize([order.id]);
    if(!estimate) {reasons.set(order.id,"no-route");remaining.push(order.id);}
    else if(estimate.durationSeconds>input.maxRouteSeconds) reasons.set(order.id,"long-route");
    else {remaining.push(order.id);singles.set(order.id,estimate);}
  }
  remaining.sort((a,b)=>slack(a)-slack(b)||(a<b?-1:a>b?1:0));
  function improve(group:PlannedRoute,others:PlannedRoute[]) {
    while(group.ids.length<input.capacity && remaining.length && !stats.budgetLimited) {
      const compatibility=(id:string)=>Math.min(...group.ids.map(s=>{
        const a=input.matrix.durations[index(s)][index(id)],b=input.matrix.durations[index(id)][home];
        const c=input.matrix.durations[home][index(id)],d=input.matrix.durations[index(id)][index(s)];
        return Math.min(a===null||b===null?Infinity:a+b,c===null||d===null?Infinity:c+d);
      }));
      const candidates=[...remaining].sort((a,b)=>compatibility(a)-compatibility(b)||slack(a)-slack(b)||(a<b?-1:1)).slice(0,4);
      let best=group, bestScore=planScore(input,[...others,group]);
      for(const id of candidates) {
        const estimate=optimize([...group.ids,id]);
        if(!estimate || estimate.durationSeconds>input.maxRouteSeconds) continue;
        const proposal={...group,ids:estimate.ids,estimate}, score=planScore(input,[...others,proposal]);
        if(comparePlans(score,bestScore)<0) {best=proposal;bestScore=score;}
      }
      if(best===group) break;
      const added=best.ids.find(id=>!group.ids.includes(id))!;
      remaining.splice(remaining.indexOf(added),1);group=best;
    }
    return group;
  }
  while(remaining.length && routes.length<couriers.length) {
    const seedIndex=remaining.findIndex(id=>singles.has(id));
    let seedEstimate=seedIndex>=0?singles.get(remaining[seedIndex])!:null;
    if(!seedEstimate&&input.capacity>=2&&!stats.budgetLimited) {
      // A directed cycle can exist through a second stop even when no single round trip does.
      for(const other of remaining.slice(1,5)) {
        const pair=optimize([remaining[0],other]);
        if(pair&&pair.durationSeconds<=input.maxRouteSeconds){seedEstimate=pair;break;}
      }
    }
    if(!seedEstimate)break;
    let group:PlannedRoute={courierId:couriers[routes.length].id,ids:seedEstimate.ids,estimate:seedEstimate};
    for(const id of group.ids)remaining.splice(remaining.indexOf(id),1);
    group=improve(group,routes);
    routes.push(group);
  }
  // One bounded final pass evaluates insertion against all proposed routes and their pending orders.
  for(let i=0;i<routes.length&&remaining.length&&!stats.budgetLimited;i++)
    routes[i]=improve(routes[i],routes.filter((_,j)=>j!==i));
  for(const id of remaining) if(!reasons.has(id))reasons.set(id,couriers.length===0?"couriers":stats.budgetLimited?"budget":"capacity");
  return summarize(input,routes,reasons,stats);
}
