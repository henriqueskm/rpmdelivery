"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Brand } from "@/components/brand";
import { FormField } from "@/components/form-field";
import { WorkspaceStatus } from "@/components/workspace-status";
import { useWorkspace } from "@/hooks/use-workspace";
import { getSupabase } from "@/lib/supabase/client";
import { loadManagement, invitationMessage, type Management } from "@/services/invitations";
import { CourierInviteCard } from "./invite-card";
import { useOperationsClock } from "@/features/operations/use-operations-clock";
import "./invitations.css";
export function CourierManagement() {
  const { state, retry } = useWorkspace("dashboard");
  const id = state.status === "ready" ? state.restaurant?.id : undefined;
  const userId = state.status === "ready" ? state.user.id : undefined;
  const [loaded, setLoaded] = useState<{ restaurantId: string; userId: string; data: Management } | null>(null);
  const data = loaded && loaded.restaurantId === id && loaded.userId === userId ? loaded.data : null;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const now = useOperationsClock();
  const refresh = useCallback(async () => {
    if (!id || !userId) return;
    try { setLoaded({ restaurantId: id, userId, data: await loadManagement(id) }); setError(""); }
    catch (cause) { setLoaded(null); setError(invitationMessage(cause)); }
  }, [id, userId]);
  useEffect(() => {
    if (!id || !userId) return;
    let active = true;
    loadManagement(id).then(result => { if (active) { setLoaded({ restaurantId: id, userId, data: result }); setError(""); } }, cause => { if (active) setError(invitationMessage(cause)); });
    return () => { active = false; };
  }, [id, userId]);
  async function command(action: () => PromiseLike<{ error: unknown }>, message: string) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setNotice("");
    try {
      const result = await action();
      if (result.error) throw result.error;
      await refresh(); setNotice(message);
    } catch (cause) { setNotice(invitationMessage(cause)); await refresh(); }
    finally { submitting.current = false; setBusy(false); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    const fields = new FormData(event.currentTarget);
    void command(() => getSupabase().rpc("create_courier_invite", { p_restaurant_id: id, p_hours: Number(fields.get("hours")), p_max_uses: Number(fields.get("uses")) }).retry(false), "Convite criado. Exiba o QR Code ou copie o link para compartilhar.");
  }
  if (state.status !== "ready" || !state.restaurant) return <WorkspaceStatus message={state.status === "error" ? state.message : undefined} retry={retry} />;
  return <main className="invite-page">
    <header className="invite-header"><Brand /><nav><Link href="/dashboard">Voltar à operação</Link><a href="#courier-requests">Solicitações</a><a href="#courier-invites">Convites</a><span>{state.restaurant.name}</span></nav></header>
    <h1>Motoboys e convites</h1><p>Vínculos reais da sua loja. A aprovação não inicia turno nem rota.</p>
    {error && <div className="notice error invite-section" role="alert">{error}<button className="text-button" onClick={refresh}>Atualizar</button></div>}
    {notice && <p className="notice invite-message" role="status">{notice}</p>}
    {!data && !error && <p role="status">Carregando convites e solicitações…</p>}
    {data && <div className="invite-grid">
      <section className="invite-requests" aria-label="Solicitações pendentes" id="courier-requests" tabIndex={-1}><h2>Solicitações pendentes · {data.requests.length}</h2><p className="invite-note">Confira a pessoa e a moto antes de aprovar.</p>
        {!data.requests.length && <div className="invite-card"><p>Nenhuma solicitação pendente.</p></div>}
        {data.requests.map(request => <article className="invite-card" key={request.id}><h2>{request.name}</h2><span className="invite-status" data-status="PENDING">Pendente</span>
          <p>{request.motorcycleModel ?? "Modelo não informado"} · {request.motorcycleColor ?? "Cor não informada"}</p><p>Placa: {request.motorcyclePlate ?? "Não informada"}</p>
          <div className="invite-actions">{[true, false].map(approve => <button key={String(approve)} className={`button ${approve ? "primary" : "invite-secondary"}`} disabled={busy} onClick={() => void command(() => getSupabase().rpc("review_courier_membership", { p_restaurant_id: state.restaurant!.id, p_relationship_id: request.id, p_approve: approve }).retry(false), approve ? "Vínculo aprovado. O motoboy verá o status em Meus estabelecimentos." : "Solicitação rejeitada.")}>{approve ? "Aprovar" : "Rejeitar"}</button>)}</div>
        </article>)}
        <button className="text-button" onClick={refresh} disabled={busy}>Atualizar solicitações</button>
      </section>
      <section aria-label="Convites" id="courier-invites" tabIndex={-1}><h2>Convites da loja</h2>
        <form className="invite-card" aria-label="Gerar convite" onSubmit={create} aria-busy={busy}><fieldset disabled={busy}>
          <FormField label="Validade (horas)" id="invite-hours" name="hours" type="number" min={1} max={168} defaultValue={72} required />
          <FormField label="Limite de usos" id="invite-uses" name="uses" type="number" min={1} max={100} defaultValue={20} required />
          <button className="button primary">{busy ? "Aguarde…" : "Gerar convite"}</button>
        </fieldset></form>
        {!data.invites.length && <p className="invite-note">Nenhum convite. Gere um para receber solicitações.</p>}
        {data.invites.map(invite => <CourierInviteCard key={invite.id} now={now} invite={invite} busy={busy} revoke={() => void command(() => getSupabase().rpc("revoke_courier_invite", { p_restaurant_id: state.restaurant!.id, p_invite_id: invite.id }).retry(false), "Convite revogado. Vínculos já aprovados continuam válidos.")} />)}
      </section>
    </div>}
  </main>;
}
