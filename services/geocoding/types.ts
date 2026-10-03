export type AddressSuggestion = {
  id: string;
  label: string;
  secondaryLabel: string;
};

export type ResolvedAddress = {
  address: string;
  latitude: number;
  longitude: number;
  provider: "mapbox";
  providerId: string;
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
    && /^[A-Za-z0-9_-]{1,255}$/.test(address.providerId);
}
