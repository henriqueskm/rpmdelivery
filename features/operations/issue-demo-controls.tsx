import type { Command, DemoState } from "./model";
import { nextDelivery } from "./route-progress";

export function IssueDemoControls({state,onCommand}:{state: DemoState;onCommand: (command: Command) => boolean}) {
  const routes=state.routes.filter(r=>r.status==="ON_ROUTE"&&nextDelivery(state,r));
  function simulate(multiple: boolean) {
    for(const route of routes.slice(0,multiple?3:1)) {
      const order=nextDelivery(state,route)!;
      onCommand({type:"delivery-failure",routeId:route.id,orderId:order.id,actorId:route.courierId,now:Date.now(),
        commandId:`courier:${order.id}:${order.attemptNumber??1}:failure`,expectedAttempt:order.attemptNumber??1,
        reason:"CUSTOMER_NOT_FOUND",description:"Contato sem resposta na simulação. Conferir referência de entrega."});
    }
  }
  return <div className="ops-issue-demo-tools"><span>Teste local · motoboys demonstrativos</span>
    <button disabled={!routes.length} onClick={()=>simulate(false)}>Simular nova ocorrência</button>
    {routes.length>=3&&<button onClick={()=>simulate(true)}>Simular 3 ocorrências simultâneas</button>}
  </div>;
}
