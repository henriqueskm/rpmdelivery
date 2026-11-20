"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Brand } from "@/components/brand";
import { FormField } from "@/components/form-field";
import { WorkspaceStatus } from "@/components/workspace-status";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatBrazilianMobilePhone, isValidBrazilianMobilePhone } from "@/lib/brazilian-mobile-phone";
import { loadRestaurantProfile, updateRestaurantProfile, type RestaurantProfile } from "@/services/restaurant";
import type { ResolvedAddress } from "@/services/geocoding/types";
import "@/features/invitations/invitations.css";
import "./store.css";

/**
 * "Dados da loja": name, phone and address. The address is where routes start and where the courier's
 * "cheguei na loja" is checked, so it only changes to an address picked from the list (with its pin).
 */
export function StoreProfile() {
  const { state, retry } = useWorkspace("dashboard");
  const restaurantId = state.status === "ready" ? state.restaurant?.id : undefined;
  const userId = state.status === "ready" ? state.user.id : undefined;
  const [profile, setProfile] = useState<RestaurantProfile | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [changingAddress, setChangingAddress] = useState(false);
  const [address, setAddress] = useState<ResolvedAddress | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!restaurantId || !userId) return;
    let active = true;
    loadRestaurantProfile(restaurantId, userId).then(loaded => {
      if (!active) return;
      setProfile(loaded); setName(loaded.name); setPhone(loaded.phone ? formatBrazilianMobilePhone(loaded.phone) : ""); setLoadError("");
    }, cause => { if (active) setLoadError(cause instanceof Error ? cause.message : "Não foi possível carregar os dados da loja."); });
    return () => { active = false; };
  }, [restaurantId, userId]);

  if (state.status !== "ready" || !state.restaurant)
    return <WorkspaceStatus message={state.status === "error" ? state.message : undefined} retry={retry} />;

  const phoneValid = !phone.trim() || isValidBrazilianMobilePhone(phone);
  const canSave = !!profile?.canEdit && !!name.trim() && phoneValid && (!changingAddress || !!address) && !pending;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !canSave || saving.current) return;
    saving.current = true; setPending(true); setMessage(null);
    try {
      await updateRestaurantProfile(profile.id, name, phone, changingAddress && address ? address : undefined);
      const fresh = await loadRestaurantProfile(profile.id, userId!);
      setProfile(fresh); setName(fresh.name); setPhone(fresh.phone ? formatBrazilianMobilePhone(fresh.phone) : "");
      setChangingAddress(false); setAddress(null);
      setMessage({ text: "Dados da loja salvos.", error: false });
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "Não foi possível salvar.", error: true });
    } finally { saving.current = false; setPending(false); }
  }

  return <main className="invite-page store-page">
    <header className="invite-header"><Brand /><nav><Link href="/dashboard">Voltar à operação</Link><span>{state.restaurant.name}</span></nav></header>
    <h1>Dados da loja</h1>
    <p>O endereço é de onde as rotas saem e onde o motoboy confirma que voltou. Confira se o ponto está certo.</p>
    {loadError && <div className="notice error invite-section" role="alert">{loadError}</div>}
    {!profile && !loadError && <p role="status">Carregando os dados da loja…</p>}
    {profile && <form className="invite-card store-form" onSubmit={save} aria-label="Dados da loja" aria-busy={pending}>
      {!profile.canEdit && <p className="notice" role="note">Somente o dono ou um gerente da loja altera estes dados.</p>}
      <fieldset disabled={pending || !profile.canEdit}>
        <FormField label="Nome da loja" id="store-name" name="name" required maxLength={160} autoComplete="organization"
          value={name} onChange={event => setName(event.target.value)} />
        <FormField label="Celular da loja (opcional)" id="store-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel"
          maxLength={19} placeholder="(11) 99999-9999" value={phone} aria-invalid={!phoneValid}
          onChange={event => setPhone(formatBrazilianMobilePhone(event.target.value))}
          hint={phoneValid ? "O motoboy liga para este número pela lista de entregas." : "Informe um celular com DDD e 9 dígitos, começando com 9."} />
        <div className="store-address">
          <span className="store-address-label">Endereço da loja</span>
          {!changingAddress ? <>
            <p className="store-address-current">{profile.address}</p>
            {profile.latitude === null && <p className="store-address-warning">Sem ponto no mapa: escolha o endereço na lista para o motoboy conseguir confirmar a chegada.</p>}
            {profile.canEdit && <button type="button" className="text-button" onClick={() => setChangingAddress(true)}>Trocar endereço</button>}
          </> : <>
            <AddressAutocomplete onChange={setAddress} placeholder="Nome da rua e número" mapAlt="Mapa do novo endereço da loja, com marcador" />
            <button type="button" className="text-button" onClick={() => { setChangingAddress(false); setAddress(null); }}>Manter o endereço atual</button>
          </>}
        </div>
        <button className="button primary" type="submit" disabled={!canSave}>{pending ? "Salvando…" : "Salvar dados da loja"}</button>
      </fieldset>
      {message && <p className={`notice ${message.error ? "error" : ""} invite-message`} role={message.error ? "alert" : "status"}>{message.text}</p>}
    </form>}
  </main>;
}
