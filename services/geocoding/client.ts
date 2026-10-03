import { getSupabase } from "@/lib/supabase/client";
import { isResolvedAddress, type AddressSuggestion } from "./types";

async function post(path: string, body: object, signal: AbortSignal) {
  const { data: { session } } = await getSupabase().auth.getSession();
  if (!session) throw new Error("Entre novamente para buscar seu endereço.");
  const response = await fetch(`/api/geocoding/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body), signal, cache: "no-store",
  });
  if (!response.ok) throw new Error("Não foi possível buscar o endereço. Tente novamente.");
  return response.json();
}

export async function suggestAddress(query: string, signal: AbortSignal): Promise<AddressSuggestion[]> {
  const suggestions: AddressSuggestion[] = await post("suggest", { query }, signal);
  if (!Array.isArray(suggestions)) throw new Error("Busca indisponível.");
  return suggestions.slice(0, 5);
}

export async function resolveAddress(mapboxId: string, signal: AbortSignal) {
  const address: unknown = await post("resolve", { mapboxId }, signal);
  if (!isResolvedAddress(address)) throw new Error("Não foi possível confirmar o endereço.");
  return address;
}
