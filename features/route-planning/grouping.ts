// Route suggestions, phase 1 (docs/route-suggestions.md): the store's own rules decide what goes together,
// and an estimated detour on the way decides whether it is worth it. Pure: no React, no fetch, no clock.
//
// Travel times are ESTIMATES in this phase: straight-line distance × ROAD_FACTOR at a city motorcycle
// speed. Phase 2 swaps them for street times (Mapbox Matrix) without changing the rules below.

import { MAX_STOPS, type Coordinate } from "../route-optimization/types.ts";

export type SuggestionParameters = {
  /** Deliveries per route (1–8). */
  maxStops: number;
  /** Extra minutes a delivery may add to the route to ride along ("no caminho"). */
  maxDetourSeconds: number;
  /** Two different bairros count as neighbors when their deliveries are this close. */
  neighborMeters: number;
  /** Minutes at each door. */
  serviceSeconds: number;
};

/** The store's decision (2026-11-22): up to 8 per route, 10 min of detour, 2 km between neighbor bairros. */
export const DEFAULT_SUGGESTION_PARAMETERS: SuggestionParameters = {
  maxStops: 8, maxDetourSeconds: 600, neighborMeters: 2000, serviceSeconds: 180,
};

/** Streets are longer than the straight line; 1.35 is a common urban detour index. */
export const ROAD_FACTOR = 1.35;
/** 25 km/h: a motorcycle in town, with stops and traffic lights. */
export const SPEED_METERS_PER_SECOND = 25_000 / 3600;
/** Two pins this close are the same building. */
const SAME_PLACE_METERS = 40;

export type SuggestionOrder = {
  id: string; reference: string; address: string; neighborhood: string;
  location?: Coordinate; deadlineAt: number; createdAt: number;
};

/** Why an order rides with the others, strongest first. */
export type Reason = "same-address" | "same-street" | "same-neighborhood" | "neighbor" | "on-the-way";
const RANK: Record<Reason, number> = { "same-address": 0, "same-street": 1, "same-neighborhood": 2, "neighbor": 3, "on-the-way": 4 };

export type SuggestedStop = {
  id: string;
  /** Absent on the order the route was built around. */
  reason?: Reason;
  /** The order it was matched with (its reference). */
  with?: string;
  /** Straight-line meters to that order (neighbor) or estimated extra seconds (on the way). */
  meters?: number; detourSeconds?: number;
  /** Estimated completion after the promised time. */
  lateSeconds: number;
};
export type Suggestion = {
  stops: SuggestedStop[];
  /** Estimated: leaving now, back at the store. */
  durationSeconds: number; distanceMeters: number; lateCount: number;
};
export type SuggestionResult = { suggestions: Suggestion[]; withoutLocation: string[] };

/** Accents, case, abbreviations and punctuation never split the same place. */
export function normalizePlace(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[.,;:()]/g, " ")
    .replace(/\b(r)\b/g, "rua").replace(/\b(av)\b/g, "avenida").replace(/\b(al)\b/g, "alameda")
    .replace(/\b(tv|trav)\b/g, "travessa").replace(/\b(pc|pca)\b/g, "praca").replace(/\b(rod)\b/g, "rodovia")
    .replace(/\b(jd|jdm)\b/g, "jardim").replace(/\b(vl)\b/g, "vila").replace(/\b(pq)\b/g, "parque")
    .replace(/\b(res)\b/g, "residencial").replace(/\b(cj|conj)\b/g, "conjunto")
    .replace(/\s+/g, " ").trim();
}

/** "Rua das Acácias, 55 - Apto 3" → street "rua das acacias", number "55". */
export function splitAddress(address: string): { street: string; number: string } {
  const [streetPart = "", rest = ""] = address.split(",", 2);
  const number = rest.match(/\d+[a-z]?/i)?.[0]?.toLowerCase() ?? "";
  return { street: normalizePlace(streetPart), number };
}

/** Great-circle meters. */
export function straightMeters(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180, earth = 6_371_000;
  const dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated street meters and seconds between two points (phase 1). */
export function estimateLeg(a: Coordinate, b: Coordinate) {
  const meters = Math.round(straightMeters(a, b) * ROAD_FACTOR);
  return { meters, seconds: Math.round(meters / SPEED_METERS_PER_SECOND) };
}

type Located = SuggestionOrder & { location: Coordinate };

/** The strongest written relation between two orders, if any. */
export function relation(a: SuggestionOrder, b: SuggestionOrder, params: SuggestionParameters): { reason: Reason; meters?: number } | null {
  const sa = splitAddress(a.address), sb = splitAddress(b.address);
  const meters = a.location && b.location ? straightMeters(a.location, b.location) : undefined;
  if ((sa.street && sa.street === sb.street && sa.number && sa.number === sb.number)
    || (meters !== undefined && meters <= SAME_PLACE_METERS)) return { reason: "same-address" };
  if (sa.street && sa.street === sb.street) return { reason: "same-street" };
  const na = normalizePlace(a.neighborhood), nb = normalizePlace(b.neighborhood);
  if (na && na === nb) return { reason: "same-neighborhood" };
  if (na && nb && meters !== undefined && meters <= params.neighborMeters) return { reason: "neighbor", meters: Math.round(meters) };
  return null;
}

/** Estimated seconds and meters of store → stops (in this order) → store, and each stop's completion. */
function walk(store: Coordinate, stops: Located[], departureAt: number, serviceSeconds: number) {
  let at = store, seconds = 0, meters = 0;
  const done: { id: string; lateSeconds: number; completedAt: number }[] = [];
  for (const stop of stops) {
    const step = estimateLeg(at, stop.location);
    seconds += step.seconds; meters += step.meters;
    const completedAt = departureAt + (seconds + serviceSeconds) * 1000;
    done.push({ id: stop.id, completedAt, lateSeconds: Math.max(0, Math.round((completedAt - stop.deadlineAt) / 1000)) });
    seconds += serviceSeconds; at = stop.location;
  }
  const back = estimateLeg(at, store);
  return { seconds: seconds + back.seconds, meters: meters + back.meters, done };
}

/** Seconds on the street of store → stops → store, without the time at the doors. */
function rideSeconds(store: Coordinate, stops: Located[]) {
  const points = [store, ...stops.map(stop => stop.location), store];
  let seconds = 0;
  for (let i = 0; i < points.length - 1; i++) seconds += estimateLeg(points[i], points[i + 1]).seconds;
  return seconds;
}

const lateCount = (done: { lateSeconds: number }[]) => done.filter(stop => stop.lateSeconds > 0).length;

/**
 * How good a sequence is, best first: fewer late stops, fewer late seconds, less riding in whole
 * minutes, then the customers served sooner on the whole (a few seconds of riding never beat a
 * customer served ten minutes earlier), then the exact riding.
 */
function score(store: Coordinate, stops: Located[], departureAt: number, serviceSeconds: number): number[] {
  const { done } = walk(store, stops, departureAt, serviceSeconds);
  const ride = rideSeconds(store, stops);
  return [lateCount(done), done.reduce((sum, stop) => sum + stop.lateSeconds, 0), Math.round(ride / 60),
    done.reduce((sum, stop) => sum + (stop.completedAt - departureAt) / 1000, 0), ride];
}
function better(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * The best place to put [candidate] in [route], and its detour: how much more the courier rides than
 * the longer of the two trips (the route as it is, or the candidate alone). Symmetric on purpose:
 * 3 km down a road is on the way to 7 km down the same road, whichever was ordered first, while a
 * delivery the other way round costs nearly its whole trip.
 */
function insertion(store: Coordinate, route: Located[], candidate: Located, departureAt: number, serviceSeconds: number) {
  let best: { route: Located[]; score: number[] } | null = null;
  for (let i = 0; i <= route.length; i++) {
    const next = [...route]; next.splice(i, 0, candidate);
    const value = score(store, next, departureAt, serviceSeconds);
    if (!best || better(value, best.score)) best = { route: next, score: value };
  }
  const detour = rideSeconds(store, best!.route) - Math.max(rideSeconds(store, route), rideSeconds(store, [candidate]));
  return { extraSeconds: Math.max(0, detour), route: best!.route };
}

/**
 * The best order for the group, trying every sequence (at most 8! = 40,320) on a table of the
 * group's legs computed once; same criteria as [score].
 */
function bestSequence(store: Coordinate, group: Located[], departureAt: number, serviceSeconds: number): Located[] {
  const n = group.length;
  if (n < 2) return group;
  const points = [store, ...group.map(o => o.location)];
  const time = points.map(a => points.map(b => estimateLeg(a, b).seconds));
  const due = group.map(o => (o.deadlineAt - departureAt) / 1000);
  let best: number[] | null = null, bestOrder: number[] = [];
  const order: number[] = [], used = new Array(n).fill(false);
  // at: last point (0 = store); elapsed includes the time at the doors; ride excludes it.
  const visit = (at: number, elapsed: number, ride: number, late: number, lateSeconds: number, served: number) => {
    if (order.length === n) {
      const total = ride + time[at][0];
      const value = [late, lateSeconds, Math.round(total / 60), served, total];
      if (!best || better(value, best)) { best = value; bestOrder = [...order]; }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const arrive = time[at][i + 1], done = elapsed + arrive + serviceSeconds;
      const over = Math.max(0, Math.round(done - due[i]));
      used[i] = true; order.push(i);
      visit(i + 1, done, ride + arrive, late + (over > 0 ? 1 : 0), lateSeconds + over, served + done);
      order.pop(); used[i] = false;
    }
  };
  visit(0, 0, 0, 0, 0, 0);
  return bestOrder.map(i => group[i]);
}

/**
 * Groups the waiting orders into suggested routes, most urgent first. Each route starts from the most
 * urgent order left and takes, one at a time, the best candidate: the strongest written relation
 * (same address, street, bairro, neighbor bairro), then the smallest detour. A candidate only rides
 * along when its detour fits (the same address always does) and it makes no other stop late.
 * Orders without a pin are never guessed: they come back in [SuggestionResult.withoutLocation].
 */
export function suggestRoutes(store: Coordinate, orders: SuggestionOrder[], departureAt: number,
  params: SuggestionParameters = DEFAULT_SUGGESTION_PARAMETERS): SuggestionResult {
  return suggest(store, orders, departureAt, params);
}

function suggest(store: Coordinate, orders: SuggestionOrder[], departureAt: number, params: SuggestionParameters): SuggestionResult {
  const maxStops = Math.min(MAX_STOPS, Math.max(1, Math.floor(params.maxStops)));
  const located = orders.filter((o): o is Located => !!o.location)
    .sort((a, b) => a.deadlineAt - b.deadlineAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const withoutLocation = orders.filter(o => !o.location).map(o => o.id);
  const left = new Set(located.map(o => o.id));
  const suggestions: Suggestion[] = [];

  for (const seed of located) {
    if (!left.has(seed.id)) continue;
    left.delete(seed.id);
    let route: Located[] = [seed];
    const why = new Map<string, Omit<SuggestedStop, "id" | "lateSeconds">>();
    while (route.length < maxStops) {
      const current = walk(store, route, departureAt, params.serviceSeconds);
      let best: { order: Located; rank: number; extra: number; route: Located[]; info: Omit<SuggestedStop, "id" | "lateSeconds"> } | null = null;
      for (const candidate of located) {
        if (!left.has(candidate.id)) continue;
        // The strongest relation to any order already in the route.
        let link: { reason: Reason; meters?: number; with: string } | null = null;
        for (const member of route) {
          const found = relation(candidate, member, params);
          if (found && (!link || RANK[found.reason] < RANK[link.reason])) link = { ...found, with: member.reference };
        }
        const inserted = insertion(store, route, candidate, departureAt, params.serviceSeconds);
        if (link?.reason !== "same-address" && inserted.extraSeconds > params.maxDetourSeconds) continue;
        // Never make a stop late that would be on time: count what was late before, plus the candidate alone.
        const alone = walk(store, [candidate], departureAt, params.serviceSeconds);
        const after = walk(store, inserted.route, departureAt, params.serviceSeconds);
        if (lateCount(after.done) > lateCount(current.done) + lateCount(alone.done)) continue;
        const reason: Reason = link?.reason ?? "on-the-way";
        const rank = RANK[reason];
        if (!best || rank < best.rank || (rank === best.rank && inserted.extraSeconds < best.extra)) {
          best = { order: candidate, rank, extra: inserted.extraSeconds, route: inserted.route, info: {
            reason, with: link?.with ?? nearestReference(candidate, route),
            ...(reason === "neighbor" && link?.meters !== undefined ? { meters: link.meters } : {}),
            ...(reason === "on-the-way" ? { detourSeconds: inserted.extraSeconds } : {}),
          } };
        }
      }
      if (!best) break;
      left.delete(best.order.id);
      route = best.route;
      why.set(best.order.id, best.info);
    }
    const ordered = bestSequence(store, route, departureAt, params.serviceSeconds);
    const result = walk(store, ordered, departureAt, params.serviceSeconds);
    suggestions.push({
      stops: result.done.map(stop => ({ id: stop.id, ...why.get(stop.id), lateSeconds: stop.lateSeconds })),
      durationSeconds: result.seconds, distanceMeters: result.meters, lateCount: lateCount(result.done),
    });
  }
  return { suggestions, withoutLocation };
}

function nearestReference(candidate: Located, route: Located[]): string {
  let best = route[0];
  for (const member of route)
    if (straightMeters(candidate.location, member.location) < straightMeters(candidate.location, best.location)) best = member;
  return best.reference;
}
