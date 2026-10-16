"use client";
import Link from "next/link";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { Brand } from "@/components/brand";
import { FormField } from "@/components/form-field";
import { getSupabase } from "@/lib/supabase/client";
import { normalizeInviteCode, rememberInvite, forgetInvite } from "@/lib/invitations/context";
import { invitationMessage, resultMessage, type InviteResult } from "@/services/invitations";
import { isValidBrazilianMobilePhone, parseBrazilianMobilePhone } from "@/lib/brazilian-mobile-phone";
import { useCourierSession } from "./use-courier-session";
import { useInviteCode } from "./use-invite-code";
import "./invitations.css";

export function CourierInvitePage() {
  const session = useCourierSession();
  const code = useInviteCode() ?? "";
  const [info, setInfo] = useState<InviteResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [resolvedFor, setResolvedFor] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState("");
  const submitting = useRef(false);
  const inspectionKey = `${session.user?.id ?? ""}:${code}:${attempt}`;
  const checking = !!code && !!session.user && resolvedFor !== inspectionKey;
  useEffect(() => {
    async function initialize() {
      try {
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const incoming = fragment.get("c");
        if (fragment.has("c")) window.history.replaceState(null, "", window.location.pathname);
        await getSupabase().auth.getSession();
        if (incoming) rememberInvite(incoming);
      } catch { setError("Não foi possível guardar o convite. Confira o código e permita armazenamento neste navegador."); }
    }
    void initialize();
  }, []);
  useEffect(() => {
    if (!code || !session.user) return;
    let active = true;
    getSupabase().rpc("inspect_courier_invite", { p_code: code }).retry(false).then(({ data, error }) => {
      if (!active) return;
      if (error) { setInfo(null); setError(invitationMessage(error)); }
      else { setInfo(data); setError(data.ok ? "" : resultMessage(data)); }
      setResolvedFor(inspectionKey);
    }, () => { if (active) { setInfo(null); setResolvedFor(inspectionKey); setError(invitationMessage(null)); } });
    return () => { active = false; };
  }, [code, session.user, inspectionKey]);

  function enterCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = normalizeInviteCode(String(new FormData(event.currentTarget).get("code")));
    if (!value) { setError("Digite os 20 caracteres do código, com ou sem hífens."); return; }
    try { rememberInvite(value); setInfo(null); setAttempt(n => n + 1); setOutcome(""); setError(""); }
    catch { setError("Permita armazenamento neste navegador para continuar após o login."); }
  }
  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const fields = new FormData(event.currentTarget);
    if (!isValidBrazilianMobilePhone(String(fields.get("phone")))) {
      setError("Informe um celular com DDD e 9 dígitos."); return;
    }
    submitting.current = true; setPending(true); setError("");
    try {
      const { error } = await getSupabase().rpc("complete_courier_registration", {
        p_name: String(fields.get("name")).trim(),
        p_phone: parseBrazilianMobilePhone(String(fields.get("phone"))) ?? "",
        p_model: String(fields.get("model")).trim(), p_plate: String(fields.get("plate")).trim(),
        p_color: String(fields.get("color")).trim(),
      }).retry(false);
      if (error) throw error;
      setInfo(null); setAttempt(n => n + 1);
    } catch (cause) { setError(invitationMessage(cause)); }
    finally { submitting.current = false; setPending(false); }
  }
  async function request() {
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError("");
    try {
      const { data, error } = await getSupabase().rpc("request_courier_membership", { p_code: code }).retry(false);
      if (error) throw error;
      if (!data.ok) {
        setError(resultMessage(data));
        setInfo(current => data.reason === "profile_required" && current ? { ...current, registered: false } : { ok: false });
        if (data.reason === "profile_required") setAttempt(n => n + 1);
        return;
      }
      setOutcome(data.status === "ACTIVE" ? "Vínculo aprovado" : data.status === "REJECTED" ? "Solicitação rejeitada" : "Solicitação enviada");
      forgetInvite();
    } catch (cause) { setError(invitationMessage(cause)); }
    finally { submitting.current = false; setPending(false); }
  }
  return <main className="invite-page invite-flow">
    <header className="invite-header"><Brand /><Link href="/meus-estabelecimentos">Meus estabelecimentos</Link></header>
    <span className="eyebrow invite-section">PARA QUEM FAZ A ENTREGA</span>
    <h1>Conecte-se à sua loja.</h1>
    <p>Use o convite do restaurante. A loja confere seu cadastro antes de aprovar o vínculo.</p>
    {!code && !outcome && <form className="invite-card invite-section" onSubmit={enterCode} aria-label="Digitar convite">
      <FormField label="Código do convite" id="invite-code" name="code" required maxLength={30} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="20 caracteres, com ou sem hífens" />
      <button className="button primary">Continuar com o código</button>
    </form>}
    {code && !outcome && <div className="invite-section">
      <p>Convite guardado neste navegador por até 24 horas.</p>
      <button type="button" className="text-button" disabled={pending} onClick={() => { forgetInvite(); setInfo(null); setError(""); }}>Usar outro código</button>
    </div>}
    {session.loading && <p role="status">Conferindo sua sessão…</p>}
    {session.error && <div role="alert"><p>{session.error}</p><button className="text-button" onClick={session.retry}>Tentar novamente</button></div>}
    {!session.loading && !session.user && !session.error && <section className="invite-card">
      <h2>Entre para continuar</h2><p>Seu convite será retomado após o login ou a confirmação do e-mail. Você não precisará criar um restaurante.</p>
      <div className="invite-actions"><Link className="button primary" href="/login?perfil=motoboy">Entrar</Link><Link className="button invite-secondary" href="/cadastro?perfil=motoboy">Criar conta de motoboy</Link></div>
    </section>}
    {checking && <p role="status">Conferindo convite…</p>}
    {error && <div className="notice error invite-message" role="alert">{error}
      {session.user && code && <button type="button" className="text-button" onClick={() => setAttempt(n => n + 1)}>Conferir novamente</button>}
    </div>}
    {info?.ok && !checking && code && !outcome && <section className="invite-card invite-section">
      <h2>{info.restaurantName}</h2>
      {!info.registered ? <>
        <p className="invite-note">Complete o que falta. As informações já salvas são preservadas.</p>
        <form key={inspectionKey} onSubmit={register} aria-label="Cadastro de motoboy" aria-busy={pending}><fieldset disabled={pending}>
          <FormField label="Seu nome" id="courier-name" name="name" defaultValue={info.profile?.name ?? (typeof session.user?.user_metadata?.name === "string" ? session.user.user_metadata.name : "")} readOnly={!!info.profile?.name} hint={info.profile?.name ? "Já salvo · somente leitura" : undefined} autoComplete="name" maxLength={120} required />
          <FormField label="Celular com DDD (opcional)" id="courier-phone" name="phone" defaultValue={info.profile?.phone ?? ""} readOnly={!!info.profile?.phone} hint={info.profile?.phone ? "Já salvo · somente leitura" : undefined} type="tel" autoComplete="tel" maxLength={19} />
          <FormField label="Modelo da moto" id="courier-model" name="model" defaultValue={info.profile?.model ?? ""} readOnly={!!info.profile?.model} hint={info.profile?.model ? "Já salvo · somente leitura" : undefined} maxLength={80} required />
          <FormField label="Placa" id="courier-plate" name="plate" defaultValue={info.profile?.plate ?? ""} readOnly={!!info.profile?.plate} hint={info.profile?.plate ? "Já salvo · somente leitura" : undefined} maxLength={20} required autoCapitalize="characters" />
          <FormField label="Cor da moto" id="courier-color" name="color" defaultValue={info.profile?.color ?? ""} readOnly={!!info.profile?.color} hint={info.profile?.color ? "Já salvo · somente leitura" : undefined} maxLength={40} required />
          <button className="button primary">{pending ? "Salvando cadastro…" : "Salvar cadastro de motoboy"}</button>
        </fieldset></form>
      </> : <>
        <p>Seu cadastro de motoboy está pronto. A solicitação ficará pendente até a decisão da loja.</p>
        <p className="invite-note">O vínculo não inicia turno nem concede acesso a pedidos ou rotas.</p>
        <button className="button primary" disabled={pending} onClick={request}>{pending ? "Enviando…" : "Solicitar vínculo"}</button>
      </>}
    </section>}
    {outcome && <section className="invite-card invite-section" role="status"><h2>{outcome}</h2><p>Confira o status em Meus estabelecimentos. Um vínculo aprovado vale para os próximos turnos.</p><Link className="button primary" href="/meus-estabelecimentos">Ver meus estabelecimentos</Link></section>}
  </main>;
}
