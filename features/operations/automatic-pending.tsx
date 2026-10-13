import { useMemo, useState } from "react";
import type { Plan, PendingReason } from "../route-planning/types";
import type { DemoState } from "./model";
import { calendarTime, deadlineAt } from "./deadlines";
export const pendingLabels:Record<PendingReason,string>={
  coordinates:"Sem coordenadas confirmadas", "no-route":"Sem percurso encontrado neste lote",
  batch:"Fora do lote de 24",couriers:"Sem motoboy disponível",capacity:"Sem vaga viável nesta proposta",
  "long-route":"Trajeto excede a duração máxima",adjusted:"Fora das rotas após ajuste",
  budget:"Limite da busca: não incluído",
};
export function AutomaticPending({plan,state}:{plan:Plan;state:DemoState}) {
  const [page,setPage]=useState(0), last=Math.max(0,Math.ceil(plan.pending.length/20)-1),current=Math.min(page,last);
  const orders=useMemo(()=>new Map(state.orders.map(o=>[o.id,o])),[state.orders]);
  const pending=useMemo(()=>[...plan.pending].sort((a,b)=>deadlineAt(orders.get(a.id)!)-deadlineAt(orders.get(b.id)!)),[plan.pending,orders]);
  if(!pending.length)return null;
  return <section aria-label="Pedidos que continuam aguardando" className="ops-auto-pending">
    <p className="ops-opt-risk" data-tone={plan.pendingOverdue||plan.pendingLowerBoundLate?"danger":"attention"}>
      ⚠ Pendentes: {plan.pendingOverdue} com prazo vencido na saída estimada · {plan.pendingTight} com menos de 5 min até o limite.
      {plan.pendingLowerBoundLate>0&&<> Dentre eles, {plan.pendingLowerBoundLate} não cumpririam o prazo nem no cenário otimista de saída/retorno usado.</>}
    </p>
    <p className="ops-auto-context">Sem rota nem chegada prevista. Essas pendências exigem conferência da loja.</p>
    <details><summary>Ver {plan.pending.length} pedidos pendentes e motivos</summary>
      <p className="ops-auto-context">{plan.pendingUnestimated} sem estimativa de trajeto neste lote.
        A avaliação considera seus prazos; confirmar rotas não resolve essas pendências. Retorno usado como limite otimista exige confirmação real do motoboy.</p>
      <ul>{pending.slice(current*20,(current+1)*20).map(p=>{
        const o=orders.get(p.id)!;
        return <li key={p.id}><strong>#{o.reference} · {o.neighborhood}</strong><span>{o.customer}</span><span>{pendingLabels[p.reason]}</span><small>Limite {calendarTime(deadlineAt(o))}</small></li>;
      })}</ul>
      <div className="ops-auto-pagination"><button aria-label="Pendentes anteriores" disabled={current===0} onClick={()=>setPage(current-1)}>←</button>
        <span>{current+1}/{last+1} · 20 por página</span><button aria-label="Próximos pendentes" disabled={current===last} onClick={()=>setPage(current+1)}>→</button></div>
    </details>
  </section>;
}
