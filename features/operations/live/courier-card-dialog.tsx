"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { errorMessage } from "./commands";
import { formatCents } from "./pay";
import {
  agoText, dayText, formatPhone, initials, linkText, parseCourierCard, shiftText, type CourierCard,
} from "./courier-card";

/** Short-lived link to the private photo: enough to show it, useless if copied later. */
const PHOTO_SECONDS = 300;

/**
 * The courier card, opened by clicking a name in the couriers column: photo, contact, motorcycle,
 * link, shift and the day's numbers at this store. Read only when opened, fresh every time.
 */
export function CourierCardDialog({ shiftId, name, onClose }: {
  /** The shift whose courier to show; null keeps the dialog closed. */
  shiftId: string | null;
  /** Shown while the card loads. */
  name: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (shiftId && dialog && !dialog.open) dialog.showModal();
  }, [shiftId]);
  return (
    <dialog ref={dialogRef} className="ops-dialog ops-courier-card" aria-labelledby="ops-courier-card-title"
      onClose={onClose}>
      {/* Keyed by shift: every opening starts empty and reads the card again. */}
      {shiftId && <CardContent key={shiftId} shiftId={shiftId} name={name} close={() => dialogRef.current?.close()} />}
    </dialog>
  );
}

function CardContent({ shiftId, name, close }: { shiftId: string; name: string; close: () => void }) {
  const [card, setCard] = useState<CourierCard | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    void (async () => {
      const supabase = getSupabase();
      const { data, error: failure } = await supabase.rpc("get_courier_card", { p_shift_id: shiftId });
      if (!current) return;
      if (failure) { setError(errorMessage(failure)); return; }
      let next: CourierCard;
      try { next = parseCourierCard(data); }
      catch { setError("O painel recebeu uma resposta inesperada. Tente de novo."); return; }
      setCard(next);
      if (!next.photoPath) return;
      const { data: signed } = await supabase.storage.from("courier-photos").createSignedUrl(next.photoPath, PHOTO_SECONDS);
      if (!current) return;
      if (signed?.signedUrl) setPhoto(signed.signedUrl); else setPhotoFailed(true);
    })();
    return () => { current = false; };
  }, [shiftId]);

  const shown = card?.name ?? name;
  const moto = card ? [card.motorcycle.model, card.motorcycle.color].filter(Boolean).join(" · ") : "";
  return (<>
      <div className="ops-dialog-heading">
        <div>
          <span className="ops-kicker">MOTOBOY</span>
          <h2 id="ops-courier-card-title" dir="auto">{shown}</h2>
        </div>
        <button type="button" aria-label={`Fechar ficha de ${shown}`} onClick={close}>×</button>
      </div>

      {error && <p className="ops-pay-error" role="alert">{error}</p>}
      {!card && !error && <p className="ops-courier-card-loading" role="status">Carregando ficha…</p>}

      {card && (
        <div className="ops-courier-card-body">
          <div className="ops-courier-photo">
            {photo && !photoFailed
              // A signed URL from Storage, not a static asset: next/image would only add a proxy hop.
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={photo} alt={`Foto de ${card.name}`} width={112} height={112} onError={() => setPhotoFailed(true)} />
              : <span aria-hidden="true">{initials(card.name)}</span>}
          </div>
          {!card.photoPath && <p className="ops-courier-photo-note">Sem foto. O motoboy adiciona em Meu cadastro, no app.</p>}

          <dl className="ops-courier-facts">
            <div><dt>Celular</dt><dd>{card.phone
              ? <a href={`tel:${card.phone}`}>{formatPhone(card.phone)}</a>
              : "Não informado"}</dd></div>
            <div><dt>Moto</dt><dd dir="auto">{moto || "Não informada"}</dd></div>
            <div><dt>Placa</dt><dd>{card.motorcycle.plate || "Não informada"}</dd></div>
            <div><dt>Vínculo</dt><dd>{linkText(card.linkStatus)}{card.linkedSince && ` desde ${dayText(card.linkedSince)}`}</dd></div>
            <div><dt>Turno</dt><dd>{shiftText(card.shiftStatus)}</dd></div>
            <div><dt>Último GPS</dt><dd>{card.locationAt ? agoText(card.locationAt) : "Ainda não enviou"}</dd></div>
          </dl>

          <div className="ops-courier-numbers" aria-label="Números nesta loja">
            <div><strong>{card.today.deliveries}</strong><span>{card.today.deliveries === 1 ? "entrega hoje" : "entregas hoje"}</span></div>
            <div><strong>{formatCents(card.today.totalCents)}</strong><span>a receber hoje</span></div>
            <div><strong>{card.deliveriesHere}</strong><span>{card.deliveriesHere === 1 ? "entrega nesta loja" : "entregas nesta loja"}</span></div>
          </div>
        </div>
      )}
  </>);
}
