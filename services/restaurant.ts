import { getSupabase } from "@/lib/supabase/client";
import { parseBrazilianMobilePhone } from "@/lib/brazilian-mobile-phone";
import { isResolvedAddress, type ResolvedAddress } from "@/services/geocoding/types";

export type Restaurant = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
};

export async function findRestaurant(
  userId: string,
): Promise<Restaurant | null> {
  const client = getSupabase();
  const { data: member, error } = await client
    .from("restaurant_members")
    .select("restaurant_id")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(
      "Não foi possível consultar seu restaurante. Tente novamente.",
    );
  if (!member) return null;
  const { data, error: restaurantError } = await client
    .from("restaurants")
    .select("id, name, address, phone")
    .eq("id", member.restaurant_id)
    .single();
  if (restaurantError)
    throw new Error(
      "Não foi possível carregar seu restaurante. Tente novamente.",
    );
  return data;
}

export async function createRestaurant(
  name: string,
  address: ResolvedAddress,
  phone: string,
) {
  if (!name.trim() || name.trim().length > 160 || !isResolvedAddress(address))
    throw new Error("Confira o nome e selecione um endereço confirmado.");
  const normalizedPhone = parseBrazilianMobilePhone(phone);
  const { data, error } = await getSupabase()
    .rpc("create_restaurant", {
      p_name: name.trim(),
      p_address: address.address,
      p_phone: normalizedPhone,
      p_latitude: address.latitude,
      p_longitude: address.longitude,
      p_address_provider: address.provider,
      p_address_provider_id: address.providerId,
    })
    .retry(false);
  if (error || !data)
    throw new Error(
      "Não foi possível confirmar a criação. Confira seu vínculo antes de tentar novamente.",
    );
  return data;
}
