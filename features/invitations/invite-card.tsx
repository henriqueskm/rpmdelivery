"use client";
import { useState } from "react";
import { formatInviteCode, inviteLink, normalizeInviteCode } from "@/lib/invitations/context";
import type { Invite } from "@/services/invitations";
import { InviteQr } from "./qr-code";
export function CourierInviteCard({ invite, busy, revoke, now }: { invite: Invite; busy: boolean; revoke: () => void; now: number }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const expired = !invite.expiresAt || new Date(invite.expiresAt).getTime() <= now;
  const exhausted = invite.maxUses !== null && invite.usedCount >= invite.maxUses;
  const supported = !!normalizeInviteCode(invite.code);
  const available = invite.active && !expired && !exhausted && supported;
  const label = !supported ? "Convite antigo · gere outro" : !invite.active ? "Revogado" : expired ? "Expirado" : exhausted ? "Esgotado" : "Ativo";
  const link = supported && typeof window !== "undefined" ? inviteLink(window.location.origin, invite.code) : "";
  async function copy() {
    try { await navigator.clipboard.writeText(link); setMessage("Link copiado. Cole manualmente no WhatsApp da pessoa convidada."); }
    catch { setMessage("Não foi possível copiar. Use o código digitável ou o QR Code."); }
  }
  return <article className="invite-card">
    <span className="invite-status">{label}</span>
    <p>{invite.usedCount} de {invite.maxUses ?? "—"} usos · {invite.expiresAt ? `Validade: ${new Date(invite.expiresAt).toLocaleString("pt-BR")}` : "Sem validade definida"}</p>
    <div className="invite-actions"><button className="button invite-secondary" onClick={() => setOpen(v => !v)} aria-expanded={open}>{open ? "Ocultar convite" : "Exibir convite"}</button>{invite.active && <button className="button invite-secondary" disabled={busy} onClick={revoke}>Revogar convite</button>}</div>
    {open && <section aria-label="Compartilhar convite">
      <code className="invite-code">{formatInviteCode(invite.code)}</code>
      {available && link && <><InviteQr value={link} /><button className="button primary" onClick={copy}>Copiar link</button><p className="invite-note">A câmera normal do celular abre este mesmo convite. Compartilhe apenas com os motoboys da loja.</p></>}
      {!available && <p>Gere um novo convite para receber outras solicitações.</p>}
    </section>}
    {message && <p className="invite-note" role="status">{message}</p>}
  </article>;
}
