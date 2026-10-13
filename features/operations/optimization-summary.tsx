import type { Comparison } from "../route-optimization/types";
import { impactMetrics } from "./optimization-presentation";

export function OptimizationSummary({ result }: { result: Comparison }) {
  return <section className="ops-opt-impact" aria-label="Impacto estimado da sugestão">
    {impactMetrics(result).map(metric => <div key={metric.key} className="ops-opt-metric" data-tone={metric.tone}>
      <span className="ops-opt-metric-label">{metric.label}</span>
      <strong className="ops-opt-values"><span>{metric.before}</span><span aria-label="para">→</span><span>{metric.after}</span><small>{metric.unit}</small></strong>
      <strong className="ops-opt-delta"><span aria-hidden="true">{metric.tone === "gain" ? "↓" : metric.tone === "stable" ? "=" : metric.tone === "danger" ? "↑" : "!"}</span> {metric.delta}</strong>
      {metric.tone === "attention" && <span>Pequena desvantagem</span>}
      {metric.tone === "danger" && <span>Piora relevante</span>}
    </div>)}
  </section>;
}
