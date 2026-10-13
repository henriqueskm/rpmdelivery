export const MAX_STOPS = 8;
export const MAX_POINTS = MAX_STOPS + 1;
export type Coordinate = { longitude: number; latitude: number };
export type ConfirmedCoordinate = Coordinate & { confirmed: true; source: "fixture" | "mapbox" };
export type Point = { id: string; coordinate: ConfirmedCoordinate };
export type Stop = Point & { deadlineAt: number };
export type TravelMatrix = {
  pointIds: string[];
  coordinates: Coordinate[];
  durations: (number | null)[][];
  distances: (number | null)[][];
  source: "fixture" | "mapbox";
};
export type OptimizationInput = {
  restaurant: Point; orders: Stop[]; departureAt: number; serviceSeconds: number;
  phase: "DRAFT" | "PREPARING" | "ON_ROUTE" | "RETURNING" | "COMPLETED";
  matrix: TravelMatrix;
};
export type Arrival = { id: string; arrivalAt: number; completedAt: number; deadlineAt: number; lateSeconds: number };
export type RouteEstimate = {
  ids: string[]; stops: Arrival[]; lateCount: number; lateSeconds: number;
  travelSeconds: number; durationSeconds: number; distanceMeters: number; returnAt: number;
};
export type Comparison = {
  manual: RouteEstimate | null; suggested: RouteEstimate; allDeadlinesPossible: boolean;
  examined: number; departureAt: number; serviceSeconds: number; source: TravelMatrix["source"];
};
export class OptimizationError extends Error {
  code: "invalid" | "limit" | "coordinates" | "phase" | "matrix" | "no-route" | "unavailable";
  constructor(code: OptimizationError["code"]) {
    super(code); this.name = "OptimizationError"; this.code = code;
  }
}
export function isCoordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Coordinate>;
  return typeof c.latitude === "number" && Number.isFinite(c.latitude) && Math.abs(c.latitude) <= 90
    && typeof c.longitude === "number" && Number.isFinite(c.longitude) && Math.abs(c.longitude) <= 180;
}
export function isConfirmed(c: unknown): c is ConfirmedCoordinate {
  return isCoordinate(c) && (c as ConfirmedCoordinate).confirmed === true
    && ["fixture", "mapbox"].includes((c as ConfirmedCoordinate).source);
}
