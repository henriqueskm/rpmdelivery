import "server-only";
import { mapboxProvider } from "./mapbox-provider.ts";
import type { AddressSuggestion, GeoPoint, ResolvedAddress } from "./types.ts";

export type GeocodingProvider = {
  /** `near` biases results toward a place (the store), never filters them out. */
  suggest(query: string, signal?: AbortSignal, near?: GeoPoint): Promise<AddressSuggestion[]>;
  resolve(id: string, signal?: AbortSignal): Promise<ResolvedAddress>;
};

export const geocodingProvider: GeocodingProvider = mapboxProvider;
