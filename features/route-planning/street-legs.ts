// Turns the server's street-time table (/api/routing/legs) into a LegSource for suggestRoutes.
import type { Coordinate } from "../route-optimization/types.ts";
import type { LegSource } from "./grouping.ts";

const key = (c: Coordinate) => `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;

export type StreetTable = { durations: (number | null)[][]; distances: (number | null)[][] };

/** Validates the server's answer for [count] points; null when it is not the expected table. */
export function parseStreetTable(value: unknown, count: number): (StreetTable & { partial: boolean }) | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const grid = (g: unknown) => Array.isArray(g) && g.length === count && g.every(row => Array.isArray(row)
    && row.length === count && row.every(cell => cell === null || (typeof cell === "number" && Number.isFinite(cell) && cell >= 0)));
  if (!grid(body.durations) || !grid(body.distances)) return null;
  return { durations: body.durations as StreetTable["durations"], distances: body.distances as StreetTable["distances"],
    partial: body.partial === true };
}

/** Lookup by point (rounded to 5 decimals, like the cache); unknown legs answer null. */
export function streetLegs(points: Coordinate[], table: StreetTable): LegSource {
  const index = new Map(points.map((point, i) => [key(point), i]));
  return (from, to) => {
    const i = index.get(key(from)), j = index.get(key(to));
    if (i === undefined || j === undefined) return null;
    const seconds = table.durations[i][j], meters = table.distances[i][j];
    return seconds === null || meters === null ? null : { seconds, meters };
  };
}
