import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Management, Invite, InviteResult, Membership } from "@/services/invitations";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};
type Database = {
  public: {
    Tables: {
      restaurant_members: Table<{
        id: string;
        restaurant_id: string;
        user_id: string;
        active: boolean;
        created_at: string;
      }>;
      restaurants: Table<{
        id: string;
        name: string;
        address: string;
        phone: string | null;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      create_courier_profile: { Args: { p_motorcycle_model?: string; p_motorcycle_plate?: string; p_motorcycle_color?: string }; Returns: string };
      complete_courier_registration: { Args: { p_name: string; p_phone: string; p_model: string; p_plate: string; p_color: string }; Returns: string };
      list_courier_management: { Args: { p_restaurant_id: string }; Returns: Management };
      list_my_establishments: { Args: Record<string, never>; Returns: Membership[] };
      create_courier_invite: { Args: { p_restaurant_id: string; p_hours: number; p_max_uses: number }; Returns: Invite };
      revoke_courier_invite: { Args: { p_restaurant_id: string; p_invite_id: string }; Returns: undefined };
      inspect_courier_invite: { Args: { p_code: string }; Returns: InviteResult };
      request_courier_membership: { Args: { p_code: string }; Returns: InviteResult };
      review_courier_membership: { Args: { p_restaurant_id: string; p_relationship_id: string; p_approve: boolean }; Returns: string };
      create_restaurant: {
        Args: {
          p_name: string;
          p_address: string;
          p_phone: string | null;
          p_latitude: number;
          p_longitude: number;
          p_address_provider: string;
          p_address_provider_id: string;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let client: SupabaseClient<Database> | undefined;

export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "O acesso ainda não foi configurado. Configure a URL e a chave pública do Supabase neste ambiente.",
    );
  }
  client ??= createClient<Database>(url, key);
  return client;
}
