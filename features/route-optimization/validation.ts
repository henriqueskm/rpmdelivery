import { MAX_POINTS, MAX_STOPS, OptimizationError, isCoordinate, isConfirmed,
  type TravelMatrix, type OptimizationInput, type Point } from "./types.ts";

export function validatePoints(points: Point[]) {
  if (points.length < 2 || points.length > MAX_POINTS) throw new OptimizationError("limit");
  if (points.some(p => typeof p.id !== "string" || !p.id.trim() || p.id.length > 160) ||
    new Set(points.map(p => p.id)).size !== points.length) throw new OptimizationError("invalid");
  if (points.some(p => !isConfirmed(p.coordinate))) throw new OptimizationError("coordinates");
}
export function validateMatrix(matrix: TravelMatrix, maxPoints = MAX_POINTS) {
  const n = matrix.pointIds.length;
  if (n < 2 || n > maxPoints || new Set(matrix.pointIds).size !== n ||
    matrix.coordinates.length !== n || matrix.coordinates.some(c => !isCoordinate(c)) ||
    !["fixture", "mapbox"].includes(matrix.source)) throw new OptimizationError("matrix");
  for (const [grid, max] of [[matrix.durations, 604800], [matrix.distances, 100000000]] as const) {
    if (!Array.isArray(grid) || grid.length !== n || grid.some(row => !Array.isArray(row) || row.length !== n))
      throw new OptimizationError("matrix");
    for (let i=0;i<n;i++) for(let j=0;j<n;j++) {
      const cell = grid[i][j];
      if (cell !== null && (typeof cell !== "number" || !Number.isFinite(cell) || cell < 0 || cell > max))
        throw new OptimizationError("matrix");
      if (i === j && cell !== 0) throw new OptimizationError("matrix");
    }
  }
  matrix.durations.forEach((row, i) => row.forEach((cell, j) => {
    if ((cell === null) !== (matrix.distances[i][j] === null)) throw new OptimizationError("matrix");
    const a = matrix.coordinates[i], b = matrix.coordinates[j];
    if (a.latitude === b.latitude && a.longitude === b.longitude &&
      (cell !== 0 || matrix.distances[i][j] !== 0)) throw new OptimizationError("matrix");
  }));
}
export function validateInput(input: OptimizationInput) {
  if (!["DRAFT", "PREPARING"].includes(input.phase)) throw new OptimizationError("phase");
  if (!input.orders.length || input.orders.length > MAX_STOPS) throw new OptimizationError("limit");
  const points = [input.restaurant, ...input.orders];
  validatePoints(points);
  if (!Number.isSafeInteger(input.departureAt) || input.departureAt <= 0 || input.departureAt > 8e15 ||
    !Number.isInteger(input.serviceSeconds) || input.serviceSeconds < 0 || input.serviceSeconds > 1800 ||
    input.orders.some(o => !Number.isSafeInteger(o.deadlineAt) || o.deadlineAt <= 0 || o.deadlineAt > 8e15))
    throw new OptimizationError("invalid");
  validateMatrix(input.matrix);
  if (points.length !== input.matrix.pointIds.length || points.some(p => {
    const i = input.matrix.pointIds.indexOf(p.id), c = input.matrix.coordinates[i];
    return i < 0 || !c || c.latitude !== p.coordinate.latitude || c.longitude !== p.coordinate.longitude;
  })) throw new OptimizationError("matrix");
}
