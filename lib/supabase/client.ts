import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
