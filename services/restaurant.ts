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

export type RestaurantProfile = Restaurant & { latitude: number | null; longitude: number | null; canEdit: boolean };

/** The store's current data, and whether this user (owner or manager) may change it. */
export async function loadRestaurantProfile(restaurantId: string, userId: string): Promise<RestaurantProfile> {
  const client = getSupabase();
  const [store, member] = await Promise.all([
    client.from("restaurants").select("id, name, address, phone, latitude, longitude").eq("id", restaurantId).single(),
    client.from("restaurant_members").select("role").eq("restaurant_id", restaurantId).eq("user_id", userId)
      .eq("active", true).maybeSingle(),
  ]);
  if (store.error || !store.data) throw new Error("Não foi possível carregar os dados da loja. Tente novamente.");
  const role = member.data?.role;
  return { ...store.data, canEdit: role === "OWNER" || role === "MANAGER" };
}

const profileErrors: Record<string, string> = {
  RPM_STORE_MANAGER_REQUIRED: "Somente o dono ou um gerente da loja pode alterar estes dados.",
  RPM_STORE_FIELDS: "Informe o nome da loja (até 160 caracteres).",
  RPM_STORE_PHONE: "Informe um celular com DDD e 9 dígitos, ou deixe em branco.",
  RPM_STORE_ADDRESS: "Escolha o endereço na lista para confirmar a localização.",
};

/** Saves name and phone; with `address`, the new confirmed address and pin too. */
export async function updateRestaurantProfile(restaurantId: string, name: string, phone: string, address?: ResolvedAddress) {
  if (address && !isResolvedAddress(address)) throw new Error(profileErrors.RPM_STORE_ADDRESS);
  const { error } = await getSupabase().rpc("update_restaurant_profile", {
    p_restaurant_id: restaurantId,
    p_name: name.trim(),
    p_phone: phone.trim() ? parseBrazilianMobilePhone(phone) ?? phone.trim() : "",
    ...(address ? {
      p_address: address.address, p_latitude: address.latitude, p_longitude: address.longitude,
      p_address_provider: address.provider, p_address_provider_id: address.providerId,
    } : {}),
  }).retry(false);
  if (error) {
    const code = /RPM_[A-Z_]+/.exec(error.message ?? "")?.[0];
    throw new Error((code && profileErrors[code]) || "Não foi possível salvar. Confira a conexão e tente de novo.");
  }
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
