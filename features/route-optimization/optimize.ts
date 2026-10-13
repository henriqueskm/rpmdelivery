import { OptimizationError, type OptimizationInput, type Comparison, type RouteEstimate } from "./types.ts";
import { validateInput } from "./validation.ts";

export function estimateSequence(input: OptimizationInput, ids: string[]): RouteEstimate | null {
  validateInput(input);
  if (ids.length !== input.orders.length || new Set(ids).size !== ids.length ||
    ids.some(id => !input.orders.some(o => o.id === id))) throw new OptimizationError("invalid");
  return estimate(input, ids);
}
function estimate(input: OptimizationInput, ids: string[]): RouteEstimate | null {
  let previous = input.matrix.pointIds.indexOf(input.restaurant.id);
  let elapsed = 0, travelSeconds = 0, distanceMeters = 0, lateSeconds = 0, lateCount = 0;
  const stops: RouteEstimate["stops"] = [];
  for (const id of ids) {
    const index = input.matrix.pointIds.indexOf(id);
    const seconds = input.matrix.durations[previous][index], meters = input.matrix.distances[previous][index];
    if (seconds === null || meters === null) return null;
    elapsed += seconds; travelSeconds += seconds; distanceMeters += meters;
    const arrivalAt = input.departureAt + elapsed * 1000;
    const completedAt = arrivalAt + input.serviceSeconds * 1000;
    const deadlineAt = input.orders.find(o => o.id === id)!.deadlineAt;
    const delay = Math.max(0, (completedAt - deadlineAt) / 1000);
    if (delay > 0) lateCount++;
    lateSeconds += delay;
    stops.push({ id, arrivalAt, completedAt, deadlineAt, lateSeconds: delay });
    elapsed += input.serviceSeconds;
    previous = index;
  }
  const home = input.matrix.pointIds.indexOf(input.restaurant.id);
  const seconds = input.matrix.durations[previous][home], meters = input.matrix.distances[previous][home];
  if (seconds === null || meters === null) return null;
  elapsed += seconds; travelSeconds += seconds; distanceMeters += meters;
  return { ids: [...ids], stops, lateCount, lateSeconds, travelSeconds, durationSeconds: elapsed,
    distanceMeters, returnAt: input.departureAt + elapsed * 1000 };
}
export function compareScores(a: RouteEstimate, b: RouteEstimate) {
  return a.lateCount - b.lateCount || a.lateSeconds - b.lateSeconds ||
    a.travelSeconds - b.travelSeconds || a.distanceMeters - b.distanceMeters;
}
// Exhaustive and bounded: <=8! (40,320) complete sequences. Directed edges, no inferred shortcuts.
export function optimizeSequence(input: OptimizationInput): Comparison {
  validateInput(input);
  const manual = estimate(input, input.orders.map(o => o.id));
  let best = manual, examined = 0;
  const ids = input.orders.map(o => o.id).sort();
  function visit(prefix: string[], remaining: string[]) {
    if (!remaining.length) {
      examined++;
      const route = estimate(input, prefix);
      if (route && (!best || compareScores(route, best) < 0)) best = route;
      return;
    }
    remaining.forEach((id, i) => visit([...prefix, id], remaining.filter((_, j) => i !== j)));
  }
  visit([], ids);
  if (!best) throw new OptimizationError("no-route");
  return { manual, suggested: best, allDeadlinesPossible: best.lateCount === 0,
    examined, departureAt: input.departureAt, serviceSeconds: input.serviceSeconds, source: input.matrix.source };
}
