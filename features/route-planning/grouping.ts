// Route suggestions, phase 1 (docs/route-suggestions.md): the store's own rules decide what goes together,
// and an estimated detour on the way decides whether it is worth it. Pure: no React, no fetch, no clock.
//
// Travel times come from [LegSource] (street times from Mapbox, cached per store; phase 2) and fall back
// to an ESTIMATE where unknown: straight-line distance × ROAD_FACTOR at a city motorcycle speed.

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

/** The store's decision: up to 8 per route (2026-11-22); 7 min of detour and 1.5 km between neighbor bairros (2026-11-23). */
export const DEFAULT_SUGGESTION_PARAMETERS: SuggestionParameters = {
  maxStops: 8, maxDetourSeconds: 420, neighborMeters: 1500, serviceSeconds: 180,
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
  /** Neighbor bairros by their learned centers ([meters] is between the centers). */
  learned?: boolean;
  /** Estimated completion after the promised time. */
  lateSeconds: number;
};
export type Suggestion = {
  stops: SuggestedStop[];
  /** Estimated: leaving now, back at the store. */
  durationSeconds: number; distanceMeters: number; lateCount: number;
  /**
   * Split off a bigger route so a free courier does not wait: that route's base order, and how much
   * sooner the most helped customer gets the order than in the route as one.
   */
  split?: { from: string; soonerSeconds: number };
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

/** Street time and distance between two points; null when unknown (the estimate is used then). */
export type LegSource = (from: Coordinate, to: Coordinate) => { seconds: number; meters: number } | null;

/** The legs in use during one suggestRoutes call: street times when given, estimates otherwise. */
let leg: (a: Coordinate, b: Coordinate) => { seconds: number; meters: number } = estimateLeg;

/** Where each bairro is (normalized name → center), learned from the store's past orders (phase 3). */
export type NeighborhoodCenters = Map<string, Coordinate>;

/** The server's list (get_neighborhood_centers) as a lookup; spellings that normalize alike are merged by weight. */
export function neighborhoodCenters(list: { neighborhood: string; latitude: number; longitude: number; orders: number }[]): NeighborhoodCenters {
  const sums = new Map<string, { latitude: number; longitude: number; weight: number }>();
  for (const item of list) {
    const key = normalizePlace(item.neighborhood);
    if (!key || !(item.orders > 0)) continue;
    const sum = sums.get(key) ?? { latitude: 0, longitude: 0, weight: 0 };
    sum.latitude += item.latitude * item.orders; sum.longitude += item.longitude * item.orders; sum.weight += item.orders;
    sums.set(key, sum);
  }
  return new Map([...sums].map(([key, sum]) => [key, { latitude: sum.latitude / sum.weight, longitude: sum.longitude / sum.weight }]));
}

/** The bairro centers in use during one suggestRoutes call. */
let centers: NeighborhoodCenters | undefined;

/**
 * The strongest written relation between two orders, if any. Two bairros are neighbors when their
 * learned centers are within [SuggestionParameters.neighborMeters]; a bairro without history falls
 * back to the distance between the two orders.
 */
export function relation(a: SuggestionOrder, b: SuggestionOrder, params: SuggestionParameters,
  known: NeighborhoodCenters | undefined = centers): { reason: Reason; meters?: number; learned?: boolean } | null {
  const sa = splitAddress(a.address), sb = splitAddress(b.address);
  const meters = a.location && b.location ? straightMeters(a.location, b.location) : undefined;
  if ((sa.street && sa.street === sb.street && sa.number && sa.number === sb.number)
    || (meters !== undefined && meters <= SAME_PLACE_METERS)) return { reason: "same-address" };
  if (sa.street && sa.street === sb.street) return { reason: "same-street" };
  const na = normalizePlace(a.neighborhood), nb = normalizePlace(b.neighborhood);
  if (na && na === nb) return { reason: "same-neighborhood" };
  if (!na || !nb) return null;
  const ca = known?.get(na), cb = known?.get(nb);
  if (ca && cb) {
    const between = straightMeters(ca, cb);
    return between <= params.neighborMeters ? { reason: "neighbor", meters: Math.round(between), learned: true } : null;
  }
  if (meters !== undefined && meters <= params.neighborMeters) return { reason: "neighbor", meters: Math.round(meters) };
  return null;
}

/** Estimated seconds and meters of store → stops (in this order) → store, and each stop's completion. */
function walk(store: Coordinate, stops: Located[], departureAt: number, serviceSeconds: number) {
  let at = store, seconds = 0, meters = 0;
  const done: { id: string; lateSeconds: number; completedAt: number }[] = [];
  for (const stop of stops) {
    const step = leg(at, stop.location);
    seconds += step.seconds; meters += step.meters;
    const completedAt = departureAt + (seconds + serviceSeconds) * 1000;
    done.push({ id: stop.id, completedAt, lateSeconds: Math.max(0, Math.round((completedAt - stop.deadlineAt) / 1000)) });
    seconds += serviceSeconds; at = stop.location;
  }
  const back = leg(at, store);
  return { seconds: seconds + back.seconds, meters: meters + back.meters, done };
}

/** Seconds on the street of store → stops → store, without the time at the doors. */
function rideSeconds(store: Coordinate, stops: Located[]) {
  const points = [store, ...stops.map(stop => stop.location), store];
  let seconds = 0;
  for (let i = 0; i < points.length - 1; i++) seconds += leg(points[i], points[i + 1]).seconds;
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
  const time = points.map(a => points.map(b => (a === b ? 0 : leg(a, b).seconds)));
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
 *
 * [freeCouriers]: couriers waiting in line now. While there are more of them than routes, the longest
 * route is split in two ([bestSplit]), so nobody waits while another rides with several orders
 * (the store's decision, 2026-11-23). 0 never splits.
 */
export function suggestRoutes(store: Coordinate, orders: SuggestionOrder[], departureAt: number,
  params: SuggestionParameters = DEFAULT_SUGGESTION_PARAMETERS, streets?: LegSource, learned?: NeighborhoodCenters,
  freeCouriers = 0): SuggestionResult {
  leg = streets ? (a, b) => streets(a, b) ?? estimateLeg(a, b) : estimateLeg;
  centers = learned;
  try { return suggest(store, orders, departureAt, params, freeCouriers); } finally { leg = estimateLeg; centers = undefined; }
}

type Why = Omit<SuggestedStop, "id" | "lateSeconds">;
type Group = {
  route: Located[]; why: Map<string, Why>;
  /** Split off a bigger route: its base order, and when each of its stops would have been done. */
  split?: { from: string; before: Map<string, number> };
};

/** Most urgent first: the promised time, then who ordered first. */
const urgency = (a: SuggestionOrder, b: SuggestionOrder) =>
  a.deadlineAt - b.deadlineAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
const baseOf = (route: Located[]) => [...route].sort(urgency)[0];

function suggest(store: Coordinate, orders: SuggestionOrder[], departureAt: number, params: SuggestionParameters,
  freeCouriers: number): SuggestionResult {
  const maxStops = Math.min(MAX_STOPS, Math.max(1, Math.floor(params.maxStops)));
  const service = params.serviceSeconds;
  const located = orders.filter((o): o is Located => !!o.location).sort(urgency);
  const withoutLocation = orders.filter(o => !o.location).map(o => o.id);
  const left = new Set(located.map(o => o.id));
  const groups: Group[] = [];

  for (const seed of located) {
    if (!left.has(seed.id)) continue;
    left.delete(seed.id);
    let route: Located[] = [seed];
    const why = new Map<string, Why>();
    while (route.length < maxStops) {
      const current = walk(store, route, departureAt, service);
      let best: { order: Located; rank: number; extra: number; route: Located[]; info: Why } | null = null;
      for (const candidate of located) {
        if (!left.has(candidate.id)) continue;
        const link = strongestLink(candidate, route, params);
        const inserted = insertion(store, route, candidate, departureAt, service);
        if (link?.reason !== "same-address" && inserted.extraSeconds > params.maxDetourSeconds) continue;
        // Never make a stop late that would be on time: count what was late before, plus the candidate alone.
        const alone = walk(store, [candidate], departureAt, service);
        const after = walk(store, inserted.route, departureAt, service);
        if (lateCount(after.done) > lateCount(current.done) + lateCount(alone.done)) continue;
        const info = whyText(candidate, route, link, inserted.extraSeconds);
        const rank = RANK[info.reason!];
        if (!best || rank < best.rank || (rank === best.rank && inserted.extraSeconds < best.extra))
          best = { order: candidate, rank, extra: inserted.extraSeconds, route: inserted.route, info };
      }
      if (!best) break;
      left.delete(best.order.id);
      route = best.route;
      why.set(best.order.id, best.info);
    }
    groups.push({ route, why });
  }

  // More couriers waiting than routes: split the longest route that can be split, one at a time.
  while (groups.length < freeCouriers) {
    const longest = groups.map((group, index) => ({ index, group,
      seconds: walk(store, bestSequence(store, group.route, departureAt, service), departureAt, service).seconds }))
      .filter(item => item.group.route.length > 1).sort((a, b) => b.seconds - a.seconds);
    let splitted = false;
    for (const { index, group } of longest) {
      const parts = bestSplit(store, group.route, departureAt, params);
      if (!parts) continue;
      const split = group.split ?? { from: baseOf(group.route).reference,
        before: new Map(walk(store, bestSequence(store, group.route, departureAt, service), departureAt, service).done
          .map(stop => [stop.id, stop.completedAt])) };
      groups.splice(index, 1, ...parts.map(part => ({ route: part, why: explain(store, part, departureAt, params), split })));
      splitted = true;
      break;
    }
    if (!splitted) break;
  }

  const suggestions = groups.map(({ route, why, split }): Suggestion => {
    const result = walk(store, bestSequence(store, route, departureAt, service), departureAt, service);
    const sooner = split ? Math.max(0, ...result.done.map(stop => (split.before.get(stop.id)! - stop.completedAt) / 1000)) : 0;
    return {
      stops: result.done.map(stop => ({ id: stop.id, ...why.get(stop.id), lateSeconds: stop.lateSeconds })),
      durationSeconds: result.seconds, distanceMeters: result.meters, lateCount: lateCount(result.done),
      ...(split ? { split: { from: split.from, soonerSeconds: Math.round(sooner) } } : {}),
    };
  });
  return { suggestions, withoutLocation };
}

/** The strongest written relation of [candidate] to any order in [route]. */
function strongestLink(candidate: Located, route: Located[], params: SuggestionParameters) {
  let link: { reason: Reason; meters?: number; learned?: boolean; with: string } | null = null;
  for (const member of route) {
    const found = relation(candidate, member, params);
    if (found && (!link || RANK[found.reason] < RANK[link.reason])) link = { ...found, with: member.reference };
  }
  return link;
}

/** Why [candidate] rides with [route]: its strongest relation, or on the way with its detour. */
function whyText(candidate: Located, route: Located[], link: ReturnType<typeof strongestLink>, extraSeconds: number): Why {
  const reason: Reason = link?.reason ?? "on-the-way";
  return {
    reason, with: link?.with ?? nearestReference(candidate, route),
    ...(reason === "neighbor" && link?.meters !== undefined ? { meters: link.meters } : {}),
    ...(reason === "neighbor" && link?.learned ? { learned: true } : {}),
    ...(reason === "on-the-way" ? { detourSeconds: extraSeconds } : {}),
  };
}

/** The reasons again for a route that was split: its own base, each stop against the others left in it. */
function explain(store: Coordinate, route: Located[], departureAt: number, params: SuggestionParameters) {
  const base = baseOf(route);
  const why = new Map<string, Why>();
  for (const stop of route) {
    if (stop === base) continue;
    const others = route.filter(other => other !== stop);
    const extra = insertion(store, bestSequence(store, others, departureAt, params.serviceSeconds), stop, departureAt,
      params.serviceSeconds).extraSeconds;
    why.set(stop.id, whyText(stop, others, strongestLink(stop, others, params), extra));
  }
  return why;
}

/**
 * The route in two, for a courier who would wait otherwise; null when it cannot be split (one stop,
 * or every stop at the same address). Tries every split (at most 2^7 = 128), never parting the same
 * address, and keeps the best: fewer late stops, fewer late seconds, the longer of the two routes in
 * whole minutes (the work shared fairly), then less riding in all. The more urgent part comes first.
 */
function bestSplit(store: Coordinate, route: Located[], departureAt: number, params: SuggestionParameters): Located[][] | null {
  const n = route.length;
  if (n < 2) return null;
  const together: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    if (relation(route[i], route[j], params)?.reason === "same-address") together.push([i, j]);
  let best: { parts: Located[][]; value: number[] } | null = null;
  // route[0] stays in the first part; bit i-1 sends route[i] to the second.
  for (let mask = 1; mask < 1 << (n - 1); mask++) {
    const side = (i: number) => (i === 0 ? 0 : (mask >> (i - 1)) & 1);
    if (together.some(([i, j]) => side(i) !== side(j))) continue;
    const parts = [route.filter((_, i) => side(i) === 0), route.filter((_, i) => side(i) === 1)];
    const walked = parts.map(part => walk(store, bestSequence(store, part, departureAt, params.serviceSeconds), departureAt, params.serviceSeconds));
    const value = [walked.reduce((sum, w) => sum + lateCount(w.done), 0),
      walked.reduce((sum, w) => sum + w.done.reduce((s, stop) => s + stop.lateSeconds, 0), 0),
      Math.round(Math.max(...walked.map(w => w.seconds)) / 60), walked.reduce((sum, w) => sum + w.seconds, 0)];
    if (!best || better(value, best.value)) best = { parts, value };
  }
  return best ? best.parts.sort((a, b) => urgency(baseOf(a), baseOf(b))) : null;
}

function nearestReference(candidate: Located, route: Located[]): string {
  let best = route[0];
  for (const member of route)
    if (straightMeters(candidate.location, member.location) < straightMeters(candidate.location, best.location)) best = member;
  return best.reference;
}
