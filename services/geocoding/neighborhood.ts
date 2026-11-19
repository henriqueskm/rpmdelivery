import "server-only";

/** Mapbox context pieces used to find the bairro (no personal data: only the place itself). */
export type PlaceContext = {
  neighborhood?: { name?: string };
  postcode?: { name?: string };
  place?: { name?: string };
  region?: { region_code?: string };
  street?: { name?: string };
  address?: { street_name?: string };
};

const clean = (value: unknown) => typeof value === "string" && value.trim() && value.trim().length <= 120
  ? value.trim() : undefined;

async function viaCep(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`https://viacep.com.br/ws/${path}/json/`, {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
  });
  return response.ok ? response.json() : null;
}

/**
 * Mapbox rarely knows the bairro of Brazilian addresses, so fall back to ViaCEP: first by the full
 * CEP, then by city + street (only when every CEP of that street is in the same bairro). Any failure
 * just leaves the bairro for the store to type.
 */
export async function neighborhoodOf(context: PlaceContext | undefined, signal?: AbortSignal) {
  const known = clean(context?.neighborhood?.name);
  if (known) return known;
  try {
    const cep = context?.postcode?.name?.replace(/\D/g, "");
    if (cep?.length === 8) {
      const found = await viaCep(cep, signal);
      return found && typeof found === "object" ? clean((found as { bairro?: unknown }).bairro) : undefined;
    }
    const uf = context?.region?.region_code;
    const city = context?.place?.name;
    const street = context?.address?.street_name ?? context?.street?.name;
    if (!uf || !/^[A-Z]{2}$/.test(uf) || !city || !street || street.length < 3) return undefined;
    const found = await viaCep([uf, city, street].map(encodeURIComponent).join("/"), signal);
    if (!Array.isArray(found)) return undefined;
    const bairros = new Set(found.map((item) => clean((item as { bairro?: unknown })?.bairro)));
    return bairros.size === 1 ? [...bairros][0] : undefined;
  } catch {
    return undefined;
  }
}
