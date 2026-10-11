import "server-only";
import { isResolvedAddress, type AddressSuggestion, type ResolvedAddress } from "./types.ts";

type Feature = {
  properties?: {
    mapbox_id?: string;
    feature_type?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
    coordinates?: { latitude?: number; longitude?: number };
    context?: { country?: { country_code?: string } };
  };
};

async function forward(query: string, permanent: boolean, signal?: AbortSignal) {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error("Geocoding indisponível.");
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.search = new URLSearchParams({
    q: query, access_token: token, country: "br", language: "pt", types: "address",
    limit: permanent ? "1" : "5", autocomplete: String(!permanent), permanent: String(permanent),
  }).toString();
  const response = await fetch(url, {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Geocoding indisponível.");
  const data: { features?: Feature[] } = await response.json();
  if (!Array.isArray(data.features)) throw new Error("Geocoding indisponível.");
  return data.features.filter(({ properties: p }) => p?.feature_type === "address"
    && p.context?.country?.country_code?.toLowerCase() === "br"
    && typeof p.mapbox_id === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(p.mapbox_id)
    && typeof p.name === "string" && typeof p.full_address === "string"
    && p.full_address.length <= 500);
}

export const mapboxProvider = {
  async suggest(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
    const features = await forward(query, false, signal);
    return features.slice(0, 5).map(({ properties: p }) => ({
      id: p!.mapbox_id!, label: p!.name!, secondaryLabel: p!.place_formatted ?? "",
    }));
  },
  async resolve(id: string, signal?: AbortSignal): Promise<ResolvedAddress> {
    const [feature] = await forward(id, true, signal);
    const p = feature?.properties;
    const address = {
      address: p?.full_address, latitude: p?.coordinates?.latitude,
      longitude: p?.coordinates?.longitude, provider: "mapbox", providerId: p?.mapbox_id,
    };
    if (!isResolvedAddress(address) || address.providerId !== id)
      throw new Error("Endereço não confirmado.");
    return address;
  },
};
