import type { DemoState } from "./model";
import { calendarTime, clockTime, localDateTime } from "./deadlines";
import type { RouteEstimate } from "../route-optimization/types";

export const minutes = (seconds: number) => `${Math.ceil(seconds / 60)} min`;
export const distance = (meters: number) => `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
const margin = (seconds:number) => seconds<60 ? "<1 min" : `${Math.floor(seconds/60)} min`;
export function SequenceComparison({ title, route, state, departureAt }: {title:string; route:RouteEstimate|null; state:DemoState; departureAt:number}) {
  const time = (timestamp:number) => localDateTime(timestamp).slice(0,10) === localDateTime(departureAt).slice(0,10)
    ? clockTime(timestamp) : calendarTime(timestamp);
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
          <span className={stop.lateSeconds ? "ops-opt-late" : ""}>Limite {time(stop.deadlineAt)} · {stop.lateSeconds
            ? `atraso estimado ${minutes(stop.lateSeconds)}` : `margem estimada ${margin((stop.deadlineAt-stop.completedAt)/1000)}`}</span>
        </li>;
      })}</ol>
    </>}
  </section>;
}
