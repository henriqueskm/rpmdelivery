import "server-only";
import { isCoordinate, type Point, type TravelMatrix } from "../../features/route-optimization/types.ts";
import { validateMatrix, validatePoints } from "../../features/route-optimization/validation.ts";

type Failure = "input" | "unavailable" | "busy" | "rate-limit" | "timeout" | "cancelled" | "malformed" | "no-route";
export class MatrixError extends Error {
  code: Failure;
  constructor(code: Failure) { super("Não foi possível obter os tempos de trajeto."); this.code = code; }
}
async function readMatrixJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const limit = 262144;
  if (!response.body || Number(response.headers.get("content-length")) > limit) throw new MatrixError("malformed");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    for (;;) {
      if (signal.aborted) { await reader.cancel(); throw new MatrixError("cancelled"); }
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new MatrixError("malformed"); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
// No endpoint exports/imports this adapter. Callers must first authorize trusted persisted points and quotas.
export function createMapboxMatrixAdapter({ fetchImpl = fetch, token = () => process.env.MAPBOX_ACCESS_TOKEN,
  now = Date.now, timeoutMs = 8000 }: {
  fetchImpl?: typeof fetch; token?: () => string | undefined; now?: () => number; timeoutMs?: number;
} = {}) {
  let inFlight = false, lastStarted: number | undefined, blockedUntil = 0;
  const cache = new Map<string, { expires: number; matrix: TravelMatrix }>();
  return {
    async getMatrix(points: Point[], signal?: AbortSignal): Promise<TravelMatrix> {
      try { validatePoints(points); } catch { throw new MatrixError("input"); }
      if (points.some(p => p.coordinate.source !== "mapbox")) throw new MatrixError("input");
      if (signal?.aborted) throw new MatrixError("cancelled");
      const key = JSON.stringify(points.map(p => [p.id, p.coordinate.longitude, p.coordinate.latitude]));
      const cached = cache.get(key);
      if (cached && cached.expires > now()) return structuredClone(cached.matrix);
      if (now() < blockedUntil) throw new MatrixError("rate-limit");
      if (inFlight || (lastStarted !== undefined && now() - lastStarted < 1000)) throw new MatrixError("busy");
      const accessToken = token();
      if (!accessToken) throw new MatrixError("unavailable");
      const coordinates = points.map(p => `${p.coordinate.longitude},${p.coordinate.latitude}`).join(";");
      const url = new URL(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordinates}`);
      url.search = new URLSearchParams({ access_token: accessToken, annotations: "duration,distance" }).toString();
      const timeout = AbortSignal.timeout(timeoutMs);
      const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
      inFlight = true; lastStarted = now();
      try {
        // Full N×N, <=9 points/81 billable elements; no retries, fallback_speed or fabricated travel data.
        const response = await fetchImpl(url, { cache: "no-store", signal: abort });
        if (abort.aborted) throw new MatrixError(timeout.aborted ? "timeout" : "cancelled");
        if (response.status === 429) {
          const seconds = Number(response.headers.get("retry-after"));
          blockedUntil = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(300, seconds) : 60) * 1000;
          throw new MatrixError("rate-limit");
        }
        if (!response.ok) throw new MatrixError("unavailable");
        const data = await readMatrixJson(response, abort);
        if (abort.aborted) throw new MatrixError(timeout.aborted ? "timeout" : "cancelled");
        if (!data || typeof data !== "object") throw new MatrixError("malformed");
        const body = data as Record<string, unknown>;
        if (body.code === "NoRoute") throw new MatrixError("no-route");
        const waypointsValid = (v: unknown) => Array.isArray(v) && v.length === points.length && v.every(p => {
          if (!p || typeof p !== "object" || !Array.isArray(p.location) || p.location.length !== 2) return false;
          return isCoordinate({ longitude: p.location[0], latitude: p.location[1] });
        });
        if (body.code !== "Ok" || !Array.isArray(body.durations) || !Array.isArray(body.distances) ||
          !waypointsValid(body.sources) || !waypointsValid(body.destinations)) throw new MatrixError("malformed");
        const matrix: TravelMatrix = { pointIds: points.map(p => p.id), coordinates: points.map(p => ({
          longitude: p.coordinate.longitude, latitude: p.coordinate.latitude,
        })), durations: body.durations, distances: body.distances, source: "mapbox" };
        try { validateMatrix(matrix); } catch { throw new MatrixError("malformed"); }
        if (cache.size >= 16) cache.clear();
        cache.set(key, { expires: now() + 30000, matrix: structuredClone(matrix) });
        return matrix;
      } catch (error) {
        if (abort.aborted) throw new MatrixError(timeout.aborted ? "timeout" : "cancelled");
        if (error instanceof MatrixError) throw error;
        // Never echo provider bodies, fetch errors or URLs (which contain the token).
        throw new MatrixError(error instanceof SyntaxError ? "malformed" : "unavailable");
      } finally { inFlight = false; }
    },
  };
}
export const mapboxMatrix = createMapboxMatrixAdapter();
