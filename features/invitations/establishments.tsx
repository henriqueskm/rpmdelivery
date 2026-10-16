"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { SignOut } from "@/features/auth/sign-out";
import { myEstablishments, invitationMessage, type Membership } from "@/services/invitations";
import { useCourierSession } from "./use-courier-session";
import "./invitations.css";
const labels = { PENDING: "Pendente", ACTIVE: "Aprovado", REJECTED: "Rejeitado", SUSPENDED: "Suspenso" };
export function Establishments() {
  const session = useCourierSession();
  const [loaded, setLoaded] = useState<{ userId: string; items: Membership[] } | null>(null);
  const items = loaded?.userId === session.user?.id ? loaded?.items : null;
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!session.user) return;
    let active = true;
    const userId = session.user.id;
    myEstablishments().then(data => { if (active) { setLoaded({ userId, items: data }); setError(""); } }, cause => { if (active) setError(invitationMessage(cause)); });
    return () => { active = false; };
  }, [session.user, attempt]);
  return <main className="invite-page">
    <header className="invite-header"><Brand /><nav><Link href="/convite">Vincular outra loja</Link>{session.user && <SignOut courier />}</nav></header>
    <h1>Meus estabelecimentos</h1><p>Acompanhe seus vínculos. A aprovação permanece válida para os próximos turnos.</p>
    {session.loading && <p role="status">Conferindo sua sessão…</p>}
    {!session.loading && !session.user && !session.error && <Link className="button primary invite-section" href="/login?perfil=motoboy">Entrar como motoboy</Link>}
    {(error || session.error) && <div role="alert" className="notice error invite-section">{error || session.error}<button className="text-button" onClick={() => { session.retry(); setAttempt(n => n + 1); }}>Atualizar</button></div>}
    {session.user && !items && !error && <p role="status">Carregando estabelecimentos…</p>}
    {session.user && items && <section className="invite-section" aria-label="Vínculos">
      {!items.length && <div className="invite-card"><h2>Nenhuma loja vinculada</h2><p>Peça um convite à loja e use o QR Code, link ou código.</p><Link className="text-button" href="/convite">Digitar um convite</Link></div>}
      {items.map(item => <article className="invite-card" key={item.id}><h2>{item.restaurantName}</h2><span className="invite-status" data-status={item.status}>{labels[item.status]}</span><p>{item.status === "ACTIVE" ? "Vínculo aprovado. Não é preciso usar o convite todos os dias. Solicitações de turno estarão disponíveis em uma próxima etapa." : item.status === "PENDING" ? "Aguardando conferência da loja. Você pode se vincular a outras lojas." : "Fale com a loja para entender a decisão. O convite não reabre um vínculo encerrado."}</p></article>)}
      <button className="text-button" onClick={() => setAttempt(n => n + 1)}>Atualizar vínculos</button>
    </section>}
  </main>;
}
