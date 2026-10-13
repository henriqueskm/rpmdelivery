import { useEffect, useRef } from "react";
import type { Plan } from "../route-planning/types";
import { availableCouriers, type DemoState } from "./model";
import { AutomaticPending, pendingLabels } from "./automatic-pending";

export function AutomaticOverview({plan,state}:{plan:Plan;state:DemoState}) {
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  const reasons=new Map<string,number>();
  for(const p of plan.pending)reasons.set(p.reason,(reasons.get(p.reason)??0)+1);
  const noCouriers=availableCouriers(state).length===0;
  const danger=plan.lateCount>0||plan.pendingOverdue>0||plan.pendingLowerBoundLate>0;
  const warning=plan.tightCount>0||plan.pendingTight>0;
  return <>
    <h3 ref={heading} tabIndex={-1} className="ops-auto-heading">{plan.routes.length?"Se confirmar todas as propostas":"Nenhuma rota proposta"}</h3>
    <div className="ops-auto-metrics">
      <div><strong>{plan.routes.length}</strong><span>{plan.routes.length===1?"rota proposta":"rotas propostas"}</span></div>
      <div data-tone={!plan.assignedCount?"stable":plan.lateCount?"danger":plan.tightCount?"attention":"gain"}><strong>{plan.assignedCount}</strong><span>{plan.assignedCount===1?"entrega proposta":"entregas propostas"}</span></div>
      <div data-tone={plan.pendingOverdue||plan.pendingLowerBoundLate?"danger":plan.pending.length?"attention":"stable"}><strong>{plan.pending.length}</strong><span>fora das propostas</span></div>
    </div>
    {!plan.routes.length&&<p className="ops-auto-cause" role="status">{!plan.waitingCount?"Não há pedidos aguardando despacho.":
      noCouriers?`Nenhum motoboy disponível. ${plan.waitingCount} ${plan.waitingCount===1?"pedido segue aguardando":"pedidos seguem aguardando"}; aguarde disponibilidade.`:
        [...reasons].map(([reason,count])=>`${count} · ${pendingLabels[reason as keyof typeof pendingLabels]}`).join("; ")+". Confira esses pedidos e os critérios."}</p>}
    {(danger||warning)&&<div className="ops-opt-risk ops-auto-risk-summary" data-tone={danger?"danger":"attention"}>
      {(plan.lateCount>0||plan.tightCount>0)&&<p>⚠ Propostas: {plan.lateCount} {plan.lateCount===1?"atraso previsto":"atrasos previstos"} · {plan.tightCount} {plan.tightCount===1?"margem":"margens"} &lt;5 min.</p>}
      {plan.pending.length>0&&<p>⚠ Fora: {plan.pendingOverdue} com prazo vencido na saída · {plan.pendingTight} {plan.pendingTight===1?"próximo":"próximos"} do limite.{plan.pendingLowerBoundLate>0&&<> {plan.pendingLowerBoundLate} {plan.pendingLowerBoundLate===1?"não cumpriria":"não cumpririam"} o prazo nem na estimativa otimista.</>}</p>}
    </div>}
    <p className="ops-auto-batch">Lote: {plan.analyzedIds.length} de {plan.waitingCount} {plan.analyzedIds.length===1?"pedido analisado":"pedidos analisados"} · sugestão limitada{plan.budgetLimited?" · limite de busca atingido":""}.</p>
    <AutomaticPending plan={plan} state={state}/>
  </>;
}
