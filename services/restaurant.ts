import { getSupabase } from "@/lib/supabase/client";

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
  address: string,
  phone: string,
) {
  const { data, error } = await getSupabase()
    .rpc("create_restaurant", {
      p_name: name.trim(),
      p_address: address.trim(),
      ...(phone.trim() ? { p_phone: phone.trim() } : {}),
    })
    .retry(false);
  if (error || !data)
    throw new Error(
      "Não foi possível confirmar a criação. Confira seu vínculo antes de tentar novamente.",
    );
  return data;
}
