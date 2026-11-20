import type { DemoOrder, DemoState, RouteOutcome } from "./model";
import { deliveryLabels } from "./issue-presentation";

// Route helpers shared by "Acompanhar rotas" (route-tracker.tsx), where every route now lives.

/** Orders delivered more than 300 m from their pin (real data only). */
export const farDeliveries = (state: DemoState) => state.orders.filter(o => o.farMeters !== undefined);

/** "350 m", "1,2 km". */
export function distanceLabel(meters: number) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m`
    : `${(meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}

/** What a stop shows on this route: how it ended here, or its live status while still on it. */
type StopView = { label: string; tone: "green" | "neutral" | "amber"; settled: boolean };
const outcomeLabels: Record<RouteOutcome, StopView> = {
  DELIVERED: { label: "Entregue", tone: "green", settled: true },
  RETURNED: { label: "Devolvido", tone: "amber", settled: true },
  CANCELLED: { label: "Cancelado", tone: "neutral", settled: true },
};
export function stopView(state: DemoState, routeId: string, order: DemoOrder): StopView | null {
  const outcome = state.routeOutcomes?.[`${routeId}:${order.id}`];
  if (outcome) return outcomeLabels[outcome];
  if (order.delivery === "DELIVERED") return outcomeLabels.DELIVERED;
  if (order.delivery === "CANCELLED") return outcomeLabels.CANCELLED;
  // Still on the route: the deadline says more than a status, except for these two.
  if (order.delivery === "RETURN_TO_STORE") return { label: deliveryLabels.RETURN_TO_STORE, tone: "amber", settled: false };
  if (order.delivery === "NEXT") return { label: "Próxima", tone: "neutral", settled: false };
  return null;
}
