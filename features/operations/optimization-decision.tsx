import { useEffect, useRef } from "react";
import type { Comparison } from "../route-optimization/types";
import type { DemoState } from "./model";
import { estimateTime, recommendation, riskSummary, stopRisk } from "./optimization-presentation";
import { OptimizationSummary } from "./optimization-summary";
import { SequenceComparison } from "./sequence-comparison";

export function OptimizationDecision({ result, state, now }: {result:Comparison; state:DemoState; now:number}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const advice = recommendation(result), risk = riskSummary(result);
  useEffect(() => { heading.current?.focus(); }, []);
  return <>
    <section className="ops-opt-recommendation" aria-label="Recomendação">
      <span>Recomendação</span><h3 ref={heading} tabIndex={-1}>{advice.title}</h3><p>{advice.reason}</p>
    </section>
    <OptimizationSummary result={result} />
    {risk && <section className="ops-opt-risk" data-tone={risk.tone} aria-label="Riscos de prazo">
      <strong><span aria-hidden="true">⚠</span> {risk.title}</strong><p>{risk.text}</p>
    </section>}
    <section className="ops-opt-sequence" aria-label="Nova sequência">
      <h3>Nova sequência <span>· {result.suggested.ids.length} pedidos</span></h3>
      <ol>{result.suggested.stops.map((stop,index) => {
        const order = state.orders.find(o => o.id === stop.id)!;
        const before = result.manual?.ids.indexOf(stop.id), moved = before !== undefined && before !== index;
        const status = stopRisk(stop,now);
        return <li key={stop.id} data-moved={moved}>
          <span className="ops-opt-position" aria-label={`Posição ${index+1}`}>{index+1}</span>
          <div className="ops-opt-stop"><div className="ops-opt-stop-identity"><strong>#{order.reference}</strong><span>{order.neighborhood}</span></div>
            <small>Entrega {estimateTime(stop.completedAt,result.departureAt)} · limite {estimateTime(stop.deadlineAt,result.departureAt)}</small></div>
          <div className="ops-opt-stop-status">
            {moved && <span className="ops-opt-moved" aria-label={`Posição alterada de ${before!+1} para ${index+1}`}>↕ {before!+1} → {index+1}</span>}
            <span className="ops-opt-stop-risk" data-tone={status.tone}>{status.tone !== "stable" && <span aria-hidden="true">⚠ </span>}{status.text}</span>
          </div>
        </li>;
      })}</ol>
    </section>
    <details className="ops-opt-details">
      <summary>Ver comparação detalhada</summary>
      <div className="ops-opt-columns"><SequenceComparison title="Ordem manual" route={result.manual} state={state} departureAt={result.departureAt} now={now} />
        <SequenceComparison title="Ordem sugerida" route={result.suggested} state={state} departureAt={result.departureAt} now={now} /></div>
    </details>
  </>;
}
