// Words for the route suggestions: why each order rides along, and the estimates.
import type { SuggestedStop } from "../../route-planning/grouping.ts";

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

/** "1,2 km", "800 m". */
export function metersText(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 50) * 50} m`;
  return `${(meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}

/** Why this order is in the route, in the store's words. */
export function reasonText(stop: SuggestedStop): string {
  const ref = stop.with ? `#${stop.with}` : "";
  switch (stop.reason) {
    case undefined: return "Pedido base da rota";
    case "same-address": return `Mesmo endereço de ${ref}`;
    case "same-street": return `Mesma rua de ${ref}`;
    case "same-neighborhood": return `Mesmo bairro de ${ref}`;
    case "neighbor": return `Bairro vizinho de ${ref}${stop.meters !== undefined ? ` (${metersText(stop.meters)})` : ""}`;
    case "on-the-way": return stop.detourSeconds && stop.detourSeconds >= 30
      ? `No caminho de ${ref} (+${minutes(stop.detourSeconds)} min)` : `No caminho de ${ref}`;
  }
}

/** "~24 min · 6,1 km". */
export function estimateText(durationSeconds: number, distanceMeters: number): string {
  return `~${minutes(durationSeconds)} min · ${metersText(distanceMeters)}`;
}

/** "pode atrasar 4 min". */
export function lateText(lateSeconds: number): string {
  return `pode atrasar ${minutes(lateSeconds)} min`;
}
