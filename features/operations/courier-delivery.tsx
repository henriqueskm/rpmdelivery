import { useEffect, useRef, useState, type RefObject, type ReactNode } from "react";
import type { Command, DemoOrder, DemoRoute } from "./model";
import { ISSUE_REASONS, type IssueReason } from "./issue-types";
import { DeadlineText } from "./deadline-view";

export function CourierDelivery({order,route,courierId,now,onCommand,actionsRef,children}:{
  order: DemoOrder; route: DemoRoute; courierId: string; now: number;
  onCommand: (command: Command) => boolean;
  actionsRef: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null), reasonRef = useRef<HTMLSelectElement>(null);
  const [failure,setFailure] = useState(false),[reason,setReason] = useState(""),[description,setDescription] = useState(""),[error,setError] = useState("");
  const attempt = order.attemptNumber ?? 1;
  useEffect(() => {heading.current?.focus();},[]);
  function failed() {
    setError("");
    if(!Object.hasOwn(ISSUE_REASONS,reason)){setError("Selecione o motivo da falha.");reasonRef.current?.focus();return;}
    if(reason==="OTHER"&&description.trim().length<3){setError("Descreva o que aconteceu, com pelo menos 3 caracteres.");return;}
    if(!onCommand({type:"delivery-failure",routeId:route.id,orderId:order.id,actorId:courierId,now:Date.now(),
      expectedAttempt:attempt,commandId:`courier:${order.id}:${attempt}:failure`,reason:reason as IssueReason,description}))setError("A rota mudou. Confira a próxima entrega antes de continuar.");
  }
  return <>
    <section className="ops-driver-current" aria-label={`Próxima entrega ${order.reference}`}>
      <span className="ops-kicker">PRÓXIMA ENTREGA · {route.orderIds.indexOf(order.id)+1} NA SEQUÊNCIA ORIGINAL</span>
      <h3 ref={heading} tabIndex={-1}>#{order.reference} · {order.customer}</h3>
      <p>{order.address} · {order.neighborhood}</p>{order.complement&&<p>{order.complement}</p>}
      {order.notes&&<p className="ops-driver-notes"><strong>Observação:</strong> {order.notes}</p>}
      {(route.retryOrderIds??[]).includes(order.id)&&<p className="ops-driver-retry">Nova tentativa liberada pela loja.</p>}
      <DeadlineText order={order} now={now}/>
      {failure&&<form id="ops-failure-form" className="ops-failure-form" onSubmit={e => {e.preventDefault();failed();}}>
        <label>Motivo da falha<select ref={reasonRef} required value={reason} onChange={e => {setReason(e.target.value);setError("");}}>
          <option value="">Selecione o motivo</option>{Object.entries(ISSUE_REASONS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>{reason==="OTHER"?"Descreva o que aconteceu":"Complemento do motivo (opcional)"}<textarea value={description} maxLength={500} minLength={reason==="OTHER"?3:undefined} required={reason==="OTHER"}
          onChange={e=>setDescription(e.target.value)} rows={3}/></label>
        <p>A falha será enviada à Central demonstrativa. Você poderá seguir para a próxima entrega.</p>
      </form>}
      {error&&<p role="alert">{error}</p>}
      {children}
    </section>
    <div ref={actionsRef} className="ops-driver-actions">
      {failure?<><button onClick={()=>{setFailure(false);setError("");heading.current?.focus();}}>Voltar à entrega</button><button className="ops-primary" type="submit" form="ops-failure-form">Registrar falha</button></>
        :<><button className="ops-primary" onClick={()=>{
          if(!onCommand({type:"delivery-complete",routeId:route.id,orderId:order.id,actorId:courierId,now:Date.now(),expectedAttempt:attempt,
            commandId:`courier:${order.id}:${attempt}:complete`}))setError("A rota mudou. Confira a próxima entrega antes de continuar.");
        }}>Entregue</button><button onClick={()=>{setFailure(true);window.requestAnimationFrame(()=>reasonRef.current?.focus());}}>Não consegui entregar</button></>}
    </div>
  </>;
}
