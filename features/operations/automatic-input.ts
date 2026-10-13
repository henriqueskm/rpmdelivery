import { fixtureMatrix } from "../route-optimization/fixtures.ts";
import { isConfirmed } from "../route-optimization/types.ts";
import { planningBatch } from "../route-planning/input.ts";
import { PlanningError, type PlanningInput, type PlanningParameters } from "../route-planning/types.ts";
import { availableCouriers, type DemoState } from "./model.ts";
import { deadlineAt } from "./deadlines.ts";

export function automaticInput(state: DemoState, scenario: string, parameters: PlanningParameters): PlanningInput {
  if(!isConfirmed(state.restaurantLocation)||state.restaurantLocation.source!=="fixture") throw new PlanningError("coordinates");
  if(scenario==="opt-unavailable") throw new PlanningError("unavailable");
  const restaurant={id:"demo-restaurant",coordinate:state.restaurantLocation};
  const orders=state.orders.map(o=>({id:o.id,delivery:o.delivery,coordinate:o.location,deadlineAt:deadlineAt(o)}));
  const points=[restaurant,...planningBatch(orders).filter(o=>isConfirmed(o.coordinate)).map(o=>({id:o.id,coordinate:o.coordinate!}))];
  if(points.some(p=>p.coordinate.source!=="fixture")) throw new PlanningError("unavailable");
  const eligible=new Set(availableCouriers(state).map(c=>c.id));
  return {...parameters,restaurant,orders,
    couriers:state.couriers.map(c=>({id:c.id,queueOrder:c.queueOrder,eligible:eligible.has(c.id)})),
    matrix:fixtureMatrix(points,scenario)};
}
