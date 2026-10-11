import "server-only";
import { mapboxProvider } from "./mapbox-provider.ts";
import type { AddressSuggestion, ResolvedAddress } from "./types.ts";

export type GeocodingProvider = {
  suggest(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]>;
  resolve(id: string, signal?: AbortSignal): Promise<ResolvedAddress>;
};

export const geocodingProvider: GeocodingProvider = mapboxProvider;
