import { useMemo, useState } from "react";
import { isConfirmed } from "../route-optimization/types";
import type { Plan, PlannedGroup } from "../route-planning/types";
import type { DemoState } from "./model";
import { estimateTime, minutes, distance, stopRisk } from "./optimization-presentation";
import { AutomaticOverview } from "./automatic-overview";

export function AutomaticRoutes({plan,state,now,selected,onSelect,onEdit,onAccept,disabled}:{
  plan:Plan;state:DemoState;now:number;selected:string[];onSelect:(ids:string[])=>void;
  onEdit:(groups:PlannedGroup[])=>void;onAccept:(ids:string[])=>void;disabled:boolean;
}) {
  const [additions,setAdditions]=useState<Record<string,string>>({});
  const orders=useMemo(()=>new Map(state.orders.map(o=>[o.id,o])),[state.orders]), analyzed=new Set(plan.analyzedIds);
  const addable=plan.pending.filter(p=>analyzed.has(p.id)).map(p=>orders.get(p.id)!).filter(o=>isConfirmed(o.location));
  function edit(routeIndex:number,ids:string[]) {
    onEdit(plan.routes.map((r,i)=>({courierId:r.courierId,ids:i===routeIndex?ids:r.ids})).filter(r=>r.ids.length));
  }
  return <section aria-label="Rotas propostas">
    <AutomaticOverview plan={plan} state={state}/>
    <div className="ops-auto-cards">{plan.routes.map((route,index)=>{
      const courier=state.couriers.find(c=>c.id===route.courierId)!;
      const urgent=route.estimate.stops.reduce((a,b)=>a.deadlineAt<=b.deadlineAt?a:b);
      const urgentOrder=orders.get(urgent.id)!;
      const destinations=[...new Set(route.ids.map(id=>orders.get(id)!.neighborhood))].join(" · ");
      const tone=route.estimate.lateCount?"danger":route.estimate.stops.some(s=>s.deadlineAt-s.completedAt<300000)?"attention":"stable";
      return <article key={route.courierId} className="ops-auto-card" aria-label={`Proposta ${index+1}`}>
        <header><label><input type="checkbox" aria-label={`Selecionar proposta ${index+1}`} checked={selected.includes(route.courierId)} disabled={disabled}
          onChange={()=>onSelect(selected.includes(route.courierId)?selected.filter(id=>id!==route.courierId):[...selected,route.courierId])}/><strong>Rota {index+1} · {courier.name}</strong></label></header>
        <p className="ops-auto-route-summary">{route.ids.length} {route.ids.length===1?"entrega":"entregas"} · {minutes(route.estimate.durationSeconds)} · {distance(route.estimate.distanceMeters)} (com retorno)</p>
        <p className="ops-auto-route-risk" data-tone={tone}>{tone==="danger"?`⚠ ${route.estimate.lateCount} ${route.estimate.lateCount===1?"atraso previsto":"atrasos previstos"}`:tone==="attention"?
          route.estimate.stops.some(s=>s.deadlineAt-s.completedAt<60000)?"⚠ Margem inferior a 1 min":"⚠ Prazo apertado":"Sem atraso previsto sob estas hipóteses"}</p>
        <p className="ops-auto-destinations">{destinations}</p>
        <small>Prazo prioritário: #{urgentOrder.reference} · {estimateTime(urgent.deadlineAt,plan.parameters.departureAt)}.</small>
        <details onToggle={e=>{
          if(!e.currentTarget.open)return;
          const target=e.currentTarget,scroll=target.closest(".ops-opt-scroll");
          if(scroll)scroll.scrollTop+=target.getBoundingClientRect().top-scroll.getBoundingClientRect().top;
        }}><summary>Conferir e ajustar pedidos</summary>
          <p className="ops-auto-context">Rota {index+1} · {courier.name} · retorno {estimateTime(route.estimate.returnAt,plan.parameters.departureAt)}.</p>
          <ol>{route.estimate.stops.map((stop,i)=>{
            const o=orders.get(stop.id)!,risk=stopRisk(stop,now);
            return <li key={o.id}><strong>{i+1}. #{o.reference} · {o.neighborhood}</strong>
              <span>{o.customer} · {o.address}</span>{o.complement&&<span>{o.complement}</span>}
              {o.notes&&<p><strong>Observação:</strong> {o.notes}</p>}
              <small>Entrega {estimateTime(stop.completedAt,plan.parameters.departureAt)} · limite {estimateTime(stop.deadlineAt,plan.parameters.departureAt)}</small>
              <span className="ops-auto-stop-risk" data-tone={risk.tone}>{risk.text}</span>
              <div className="ops-auto-edit">
                <button aria-label={`Subir pedido ${o.reference} na proposta`} disabled={disabled||i===0} onClick={()=>{const ids=[...route.ids];[ids[i-1],ids[i]]=[ids[i],ids[i-1]];edit(index,ids);}}>↑</button>
                <button aria-label={`Descer pedido ${o.reference} na proposta`} disabled={disabled||i===route.ids.length-1} onClick={()=>{const ids=[...route.ids];[ids[i+1],ids[i]]=[ids[i],ids[i+1]];edit(index,ids);}}>↓</button>
                <button aria-label={`Retirar pedido ${o.reference} da proposta`} disabled={disabled} onClick={()=>edit(index,route.ids.filter(id=>id!==o.id))}>Retirar</button>
              </div>
            </li>;
          })}</ol>
          {addable.length>0&&<div className="ops-auto-add">
            <label>Pedido pendente<select aria-label={`Adicionar pendente à proposta ${index+1}`} value={additions[route.courierId]??""}
              disabled={disabled||route.ids.length>=plan.parameters.capacity} onChange={e=>setAdditions({...additions,[route.courierId]:e.target.value})}>
              <option value="">Escolha um pedido do lote</option>
              {addable.map(o=><option key={o.id} value={o.id}>#{o.reference} · {o.neighborhood}</option>)}
            </select></label>
            <button disabled={disabled||route.ids.length>=plan.parameters.capacity||!addable.some(o=>o.id===additions[route.courierId])}
              onClick={()=>edit(index,[...route.ids,additions[route.courierId]])}>Adicionar pedido</button>
          </div>}
          <p className="ops-auto-context">Ajustes recalculam prazos sem atribuir. Para substituir, retire um pedido e escolha outro pendente deste lote.</p>
        </details>
        <button aria-label={`Confirmar rota ${index+1} de ${courier.name} (demo)`} disabled={disabled} onClick={()=>onAccept([route.courierId])}>Confirmar rota {index+1} (demo)</button>
      </article>;
    })}</div>
  </section>;
}
