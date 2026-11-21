"use client";
import { stopsBeforeText, type Tracking } from "@/lib/tracking/view";
import { useTrackingPush } from "./use-tracking-push";

/** What the rider says for each moment; nothing when the delivery went off the happy path. */
function speech(tracking: Tracking) {
  switch (tracking.status) {
    case "PREPARING": return "Oi! Eu levo o seu pedido. Assim que ele sair da loja, você vê tudo por aqui.";
    case "ON_ROUTE": {
      const stops = stopsBeforeText(tracking.stopsBefore);
      return stops ? `Já estou na rua! Faço ${stops} e depois vou até você.` : "Já estou na rua com o seu pedido!";
    }
    case "NEXT": return "Agora é a sua vez! Estou indo até você.";
    case "DELIVERED": return "Entregue! Bom apetite.";
    default: return null;
  }
}

/**
 * The rider from the map, talking to the customer, with the offer of browser notifications while the
 * delivery is still going. A website cannot float over other apps; a notification is how it reaches
 * the customer with the page closed.
 */
export function TrackingMascot({ token, tracking, live }: { token: string; tracking: Tracking; live: boolean }) {
  const { state, enable, disable } = useTrackingPush(token, live && tracking.status !== "DELIVERED");
  const line = speech(tracking);
  if (!line) return null;
  const moving = tracking.status === "ON_ROUTE" || tracking.status === "NEXT";
  return (
    <section className="tracking-mascot" aria-label="Recado do entregador">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static picture, no optimizer needed */}
      <img className={moving ? "mascot-rider is-moving" : "mascot-rider"} src="/courier/mascot-256.webp" alt="" width={96} height={99} />
      <div className="mascot-talk">
        <p className="mascot-bubble">{line}</p>
        {state === "off" && (
          <>
            <p className="mascot-offer">Quer que eu te avise quando sair, quando for a sua vez e quando eu estiver chegando? Funciona com esta página fechada.</p>
            <button type="button" className="button primary mascot-action" onClick={enable}>Avisar sobre minha entrega</button>
          </>
        )}
        {state === "working" && (
          <button type="button" className="button primary mascot-action" disabled aria-busy="true">Ligando os avisos…</button>
        )}
        {state === "on" && (
          <p className="mascot-on" role="status">
            <span aria-hidden="true">✓</span> Avisos ligados neste aparelho.
            <button type="button" className="mascot-link" onClick={disable}>Desligar</button>
          </p>
        )}
        {state === "denied" && (
          <p className="mascot-offer" role="status">As notificações estão bloqueadas para este site. Para receber os avisos, libere nas configurações do navegador.</p>
        )}
        {state === "failed" && (
          <p className="mascot-offer" role="alert">
            Não consegui ligar os avisos neste navegador. Deixe esta página aberta para acompanhar.
            <button type="button" className="mascot-link" onClick={enable}>Tentar de novo</button>
          </p>
        )}
        {state === "install" && (
          <p className="mascot-offer">No iPhone, eu consigo te avisar se você adicionar esta página à Tela de Início: toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p>
        )}
      </div>
    </section>
  );
}
