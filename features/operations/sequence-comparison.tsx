import type { DemoState } from "./model";
import { distance, estimateTime, margin, minutes, stopRisk } from "./optimization-presentation";
import type { RouteEstimate } from "../route-optimization/types";

export function SequenceComparison({ title, route, state, departureAt, now }: {title:string; route:RouteEstimate|null; state:DemoState; departureAt:number; now:number}) {
  const time = (timestamp:number) => estimateTime(timestamp,departureAt);
  return <section className="ops-opt-estimate" aria-label={title}>
    <h3>{title}</h3>
    {!route ? <p>Sem percurso completo nesta ordem. Duração e distância indisponíveis.</p> : <>
      <p className="ops-opt-metrics"><strong>{minutes(route.durationSeconds)} · {distance(route.distanceMeters)}</strong>
        <span>{route.lateCount} com atraso previsto · atraso total {minutes(route.lateSeconds)}</span>
        <span>Retorno estimado {time(route.returnAt)} · inclui atendimento e volta</span></p>
      <ol>{route.stops.map(stop => {
        const order = state.orders.find(o => o.id === stop.id)!;
        return <li key={stop.id}>
          <strong>#{order.reference} · {order.customer}</strong>
          <span>{order.neighborhood} · {order.address}</span>
          <span>Chegada {time(stop.arrivalAt)} · entrega {time(stop.completedAt)}</span>
          <span className="ops-opt-detail-risk" data-tone={stopRisk(stop,now).tone}>Limite {time(stop.deadlineAt)} · {stop.lateSeconds
            ? `atraso estimado ${minutes(stop.lateSeconds)}` : `margem estimada ${margin((stop.deadlineAt-stop.completedAt)/1000)}`}</span>
          {stopRisk(stop,now).tone !== "stable" && <span>{stopRisk(stop,now).text}</span>}
        </li>;
      })}</ol>
    </>}
  </section>;
}
