import { useEffect, useRef, type RefObject } from "react";
import type { Command, DemoState } from "./model";
import { mostUrgentOrder } from "./deadlines";
import { DeadlineText } from "./deadline-view";
import { RouteBadge, Badge } from "./ui";
import { nextDelivery } from "./route-progress";
import { deliveryFinal } from "./issue-types";
import { deliveryLabels, issueTiming } from "./issue-presentation";
import { CourierDelivery } from "./courier-delivery";

export function CourierDialog({dialogRef,state,routeId,onCommand,now,onCompletedClose}:{
  dialogRef: RefObject<HTMLDialogElement | null>; state: DemoState; routeId?: string;
  onCommand: (command: Command) => boolean; now: number; onCompletedClose: (id: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null),returnRef = useRef<HTMLButtonElement>(null),actionsRef = useRef<HTMLDivElement>(null);
  const route = state.routes.find(r => r.id === routeId),courier = state.couriers.find(c => c.id === route?.courierId);
  const previousStatus = useRef(route?.status);
  useEffect(() => {
    if(previousStatus.current!==route?.status) {
      if(route?.status==="RETURNING")returnRef.current?.focus();
      if(route?.status==="COMPLETED")closeRef.current?.focus();
    }
    previousStatus.current=route?.status;
  },[route?.status]);
  const urgent = route && mostUrgentOrder(state,route),current = route?.status==="ON_ROUTE" ? nextDelivery(state,route) : undefined;
  const orders = new Map(state.orders.map(o=>[o.id,o]));
  const sequence = route && <ol className="ops-courier-deliveries">
    {route.orderIds.map((id,index)=>{
      const o=orders.get(id)!,issue=state.issues.find(i=>i.orderId===id&&i.status==="PENDING");
      return <li key={id} data-delivery={o.delivery}>
        <strong>{index+1}. #{o.reference} · {o.customer}</strong>
        <Badge tone={o.delivery==="DELIVERED"?"green":o.delivery==="ATTEMPT_FAILED"?"orange":"neutral"}>{deliveryLabels[o.delivery]}</Badge>
        <span>{o.address} · {o.neighborhood}</span>{o.complement&&<span>{o.complement}</span>}{o.notes&&<p>{o.notes}</p>}
        {!deliveryFinal(o.delivery)&&<DeadlineText order={o} now={now}/>}
        {issue&&<p className="ops-driver-issue">A loja está decidindo · {issueTiming(issue,now).remaining}. Você pode seguir as demais entregas.</p>}
      </li>;
    })}
  </ol>;
  return <dialog ref={dialogRef} className="ops-dialog ops-courier-dialog" aria-labelledby="ops-courier-view-title"
    onClose={()=>{if(route?.status==="COMPLETED")onCompletedClose(route.id);}}>
    <div className="ops-dialog-heading"><h2 id="ops-courier-view-title">Aplicativo do motoboy</h2><button ref={closeRef} aria-label="Fechar visão do motoboy" onClick={()=>dialogRef.current?.close()}>×</button></div>
    {route&&courier&&<>
      <p className="ops-dialog-notice">Simulação local. Sem autenticação real, tracking ou notificações. Ações reais exigirão validação no backend.</p>
      <div className="ops-courier-route"><strong>{courier.name} · {route.reference}</strong><RouteBadge status={route.status}/></div>
      {route.status==="PREPARING"&&<p className={`ops-pickup ${route.pickupReleasedAt===null?"is-waiting":"is-released"}`}>
        <strong>{route.pickupReleasedAt===null?"Aguardando liberação":"Pronto para retirada"}</strong>
        <span>{route.pickupReleasedAt===null?"Você já pode conferir a rota. Aguarde a loja liberar todos os pedidos.":"Recolha todos os pedidos e confirme o início abaixo."}</span>
      </p>}
      {urgent&&<div className="ops-urgent-deadline"><span>Prazo mais urgente · #{urgent.reference}</span><DeadlineText order={urgent} now={now}/></div>}
      <p className="ops-deadline-help">Prazo prometido, sem previsão de trajeto ou garantia de chegada.</p>
      {current?<CourierDelivery key={`${current.id}:${current.attemptNumber??1}`} order={current} route={route} courierId={courier.id} now={now} onCommand={onCommand} actionsRef={actionsRef}>
        <details className="ops-driver-sequence"><summary>Ver sequência completa · {route.orderIds.length} entregas</summary>{sequence}</details>
      </CourierDelivery>:<div className="ops-driver-body">
        {route.status==="RETURNING"&&<p className="ops-driver-return">Entregas encerradas. Retorne ao estabelecimento, incluindo os pedidos marcados para retorno. Confirme a chegada para voltar ao final da fila.</p>}
        {route.status==="COMPLETED"&&<p role="status">Retorno confirmado. Você entrou no final da fila de disponíveis.</p>}
        {sequence}
      </div>}
      {route.status==="PREPARING"&&<><p className="ops-courier-action-hint">Só o motoboy atribuído confirma a retirada e inicia a rota.</p>
        <button className="ops-primary" disabled={route.pickupReleasedAt===null} onClick={()=>onCommand({type:"start",routeId:route.id,actorId:courier.id,now:Date.now()})}>Recolhi os pedidos · Iniciar rota</button></>}
      {route.status==="RETURNING"&&<button ref={returnRef} className="ops-primary" onClick={()=>onCommand({type:"arrive",routeId:route.id,actorId:courier.id,now:Date.now()})}>Confirmar retorno — simulação</button>}
    </>}
  </dialog>;
}
