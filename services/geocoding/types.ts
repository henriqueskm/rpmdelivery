export type GeoPoint = { latitude: number; longitude: number };

export type AddressSuggestion = {
  id: string;
  label: string;
  secondaryLabel: string;
  /** A street without a house number: picking it asks for the number instead of confirming. */
  kind?: "address" | "street";
};

export type ResolvedAddress = {
  address: string;
  latitude: number;
  longitude: number;
  provider: "mapbox";
  providerId: string;
  /** Bairro, when the provider or the CEP lookup knows it; the store can still edit it. */
  neighborhood?: string;
};

export function isResolvedAddress(value: unknown): value is ResolvedAddress {
  if (!value || typeof value !== "object") return false;
  const address = value as Partial<ResolvedAddress>;
  return typeof address.address === "string" && !!address.address.trim()
    && address.address.length <= 500
    && typeof address.latitude === "number" && Number.isFinite(address.latitude)
    && address.latitude >= -90 && address.latitude <= 90
    && typeof address.longitude === "number" && Number.isFinite(address.longitude)
    && address.longitude >= -180 && address.longitude <= 180
    && address.provider === "mapbox"
    && typeof address.providerId === "string"
    && /^[A-Za-z0-9_-]{1,255}$/.test(address.providerId)
    && (address.neighborhood === undefined
      || (typeof address.neighborhood === "string" && address.neighborhood.length <= 120));
}
