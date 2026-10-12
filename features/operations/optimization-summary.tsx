import type { Comparison } from "../route-optimization/types";
import { distance, minutes } from "./sequence-comparison";

export function OptimizationSummary({ result }: { result: Comparison }) {
  return <section className="ops-opt-summary" aria-label="Comparação resumida">
    {[{label:"Manual",plan:result.manual},{label:"Sugerida",plan:result.suggested}].map(({label,plan}) => {
      return <div key={label}><strong>{label}</strong>
        {!plan ? <span>Sem percurso completo</span> : <>
          <span>{minutes(plan.durationSeconds)} · {distance(plan.distanceMeters)}</span>
          <span>{plan.lateCount} com atraso previsto</span>
          <span>Atraso total {minutes(plan.lateSeconds)}</span>
        </>}
      </div>;
    })}
  </section>;
}
