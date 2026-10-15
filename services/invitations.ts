import { getSupabase } from "@/lib/supabase/client";
export type Invite = { id: string; code: string; active: boolean; expiresAt: string | null; maxUses: number | null; usedCount: number };
export type Membership = { id: string; restaurantName: string; status: "PENDING" | "ACTIVE" | "REJECTED" | "SUSPENDED" };
export type PendingCourier = { id: string; name: string; motorcycleModel: string | null; motorcyclePlate: string | null; motorcycleColor: string | null; requestedAt: string };
export type Management = { invites: Invite[]; requests: PendingCourier[] };
export type InviteResult = { ok: boolean; reason?: "unavailable" | "rate_limited" | "profile_required"; restaurantName?: string; registered?: boolean; status?: Membership["status"] };
export function invitationMessage(cause: unknown) {
  if (cause && typeof cause === "object" && "code" in cause) {
    if (cause.code === "42501") return "Somente proprietários e gerentes desta loja podem gerenciar motoboys.";
    if (cause.code === "PGRST202" || cause.code === "42883") return "Este fluxo aguarda a aplicação da migration revisada. Nenhuma solicitação foi confirmada.";
    if (cause.code === "22023") return "A solicitação mudou ou os dados são inválidos. Atualize a lista e confira.";
  }
  return "Não foi possível confirmar a operação. Atualize a lista antes de tentar novamente.";
}
export function resultMessage(result: InviteResult) {
  return result.reason === "rate_limited"
    ? "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente."
    : result.reason === "profile_required"
      ? "Complete seu cadastro de motoboy antes de solicitar o vínculo."
      : "Convite indisponível. Confira o código ou peça um novo convite à loja.";
}
export async function loadManagement(id: string): Promise<Management> {
  const { data, error } = await getSupabase().rpc("list_courier_management", { p_restaurant_id: id }).retry(false);
  if (error) throw error;
  return data;
}
export async function myEstablishments(): Promise<Membership[]> {
  const { data, error } = await getSupabase().rpc("list_my_establishments").retry(false);
  if (error) throw error;
  return data;
}
