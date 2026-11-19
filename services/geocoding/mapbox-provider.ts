import "server-only";
import { neighborhoodOf, type PlaceContext } from "./neighborhood.ts";
import { isResolvedAddress, type AddressSuggestion, type GeoPoint, type ResolvedAddress } from "./types.ts";

type Feature = {
  properties?: {
    mapbox_id?: string;
    feature_type?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
    coordinates?: { latitude?: number; longitude?: number };
    context?: PlaceContext & { country?: { country_code?: string } };
  };
};

type Search = { permanent: boolean; types: string; near?: GeoPoint; signal?: AbortSignal };

async function forward(query: string, { permanent, types, near, signal }: Search) {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error("Geocoding indisponível.");
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  const params = new URLSearchParams({
    q: query, access_token: token, country: "br", language: "pt", types,
    limit: permanent ? "1" : "5", autocomplete: String(!permanent), permanent: String(permanent),
  });
  // Bias toward the store's city: without it "Rua Jovino" lists streets across the whole country.
  if (near) params.set("proximity", `${near.longitude},${near.latitude}`);
  url.search = params.toString();
  const response = await fetch(url, {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Geocoding indisponível.");
  const data: { features?: Feature[] } = await response.json();
  if (!Array.isArray(data.features)) throw new Error("Geocoding indisponível.");
  const allowed = types.split(",");
  return data.features.filter(({ properties: p }) => allowed.includes(p?.feature_type ?? "")
    && p!.context?.country?.country_code?.toLowerCase() === "br"
    && typeof p!.mapbox_id === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(p!.mapbox_id)
    && typeof p!.name === "string" && typeof p!.full_address === "string"
    && p!.full_address.length <= 500);
}

export const mapboxProvider = {
  /** Streets come too, so the store can start with just the street name and then add the number. */
  async suggest(query: string, signal?: AbortSignal, near?: GeoPoint): Promise<AddressSuggestion[]> {
    const features = await forward(query, { permanent: false, types: "address,street", near, signal });
    return features.slice(0, 5).map(({ properties: p }) => ({
      id: p!.mapbox_id!, label: p!.name!, secondaryLabel: p!.place_formatted ?? "",
      kind: p!.feature_type === "street" ? "street" : "address",
    }));
  },
  /** Only a full address (with number) can be confirmed: a street alone does not point at a house. */
  async resolve(id: string, signal?: AbortSignal): Promise<ResolvedAddress> {
    const [feature] = await forward(id, { permanent: true, types: "address", signal });
    const p = feature?.properties;
    const address: Partial<ResolvedAddress> = {
      address: p?.full_address, latitude: p?.coordinates?.latitude,
      longitude: p?.coordinates?.longitude, provider: "mapbox", providerId: p?.mapbox_id,
    };
    if (!isResolvedAddress(address) || address.providerId !== id)
      throw new Error("Endereço não confirmado.");
    const neighborhood = await neighborhoodOf(p?.context, signal);
    return neighborhood ? { ...address, neighborhood } : address;
  },
};
