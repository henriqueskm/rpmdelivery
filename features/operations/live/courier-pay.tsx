"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { errorMessage } from "./commands";
import { centsInput, formatCents, parseCourierPay, parseReais, type CourierPay } from "./pay";

/** Local date (yyyy-mm-dd) of the store's day, as the server counts it. */
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/**
 * The store's courier pay: rates (owner or manager edits) and the day's settlement,
 * the same numbers each courier sees in the app.
 */
export function CourierPay({ restaurantId }: { restaurantId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [day, setDay] = useState(today);
  const [pay, setPay] = useState<CourierPay | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (date: string) => {
    setError("");
    const { data, error: failure } = await getSupabase().rpc("get_courier_pay", { p_restaurant_id: restaurantId, p_day: date });
    if (failure) { setError(errorMessage(failure)); return; }
    try { setPay(parseCourierPay(data)); }
    catch { setError("O painel recebeu uma resposta inesperada. Tente de novo."); }
  }, [restaurantId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const shift = parseReais(String(data.get("shiftFee") ?? ""));
    const delivery = parseReais(String(data.get("deliveryFee") ?? ""));
    if (shift === null || delivery === null) { setError("Informe valores de R$ 0 a R$ 1.000, como 30,00."); return; }
    setSaving(true); setError(""); setNotice("");
    const { error: failure } = await getSupabase().rpc("set_courier_pay", {
      p_restaurant_id: restaurantId, p_shift_fee_cents: shift, p_delivery_fee_cents: delivery });
    setSaving(false);
    if (failure) { setError(errorMessage(failure)); return; }
    setNotice("Valores salvos. Valem para turnos aprovados e entregas feitas a partir de agora.");
    await load(day);
  }

  function open() {
    // Fresh numbers every time, starting from today.
    const date = today();
    setDay(date); setNotice("");
    dialogRef.current?.showModal();
    void load(date);
  }

  const total = pay?.couriers.reduce((sum, courier) => sum + courier.totalCents, 0) ?? 0;
  return (<>
    <button type="button" className="text-button" onClick={open}>Pagamento dos motoboys</button>
    <dialog ref={dialogRef} className="ops-dialog ops-pay-dialog" aria-labelledby="ops-pay-title"
      onClose={() => { setError(""); setNotice(""); }}>
      <div className="ops-dialog-heading">
        <div>
          <span className="ops-kicker">ACERTO DO DIA</span>
          <h2 id="ops-pay-title">Pagamento dos motoboys</h2>
        </div>
        <button type="button" aria-label="Fechar pagamento dos motoboys" onClick={() => dialogRef.current?.close()}>×</button>
      </div>

      {error && <p className="ops-pay-error" role="alert">{error}</p>}
      {notice && <p className="ops-pay-notice" role="status">{notice}</p>}

      {pay && (
        <form key={`${pay.shiftFeeCents}-${pay.deliveryFeeCents}`} className="ops-pay-rates" onSubmit={save} onInput={() => setNotice("")}>
          <label>Taxa de encosta (por dia)
            <input name="shiftFee" inputMode="decimal" defaultValue={centsInput(pay.shiftFeeCents)} readOnly={!pay.canEdit}
              aria-describedby="ops-pay-help" />
          </label>
          <label>Valor por entrega
            <input name="deliveryFee" inputMode="decimal" defaultValue={centsInput(pay.deliveryFeeCents)} readOnly={!pay.canEdit}
              aria-describedby="ops-pay-help" />
          </label>
          <p id="ops-pay-help" className="ops-form-wide">
            {pay.canEdit
              ? "A encosta conta uma vez por dia por motoboy; só entregas concluídas entram. Mudar os valores não altera o que já foi ganho."
              : "Só o dono ou o gerente da loja altera estes valores."}
          </p>
          {pay.canEdit && <button type="submit" className="ops-primary" disabled={saving}>{saving ? "Salvando…" : "Salvar valores"}</button>}
        </form>
      )}

      <div className="ops-pay-day">
        <label>Dia
          <input type="date" value={day} max={today()} onChange={event => {
            const next = event.target.value; if (!next) return; setDay(next); void load(next);
          }} />
        </label>
      </div>

      {pay && (pay.couriers.length === 0
        ? <p className="ops-pay-empty">Nenhum motoboy trabalhou neste dia.</p>
        : (
          <table className="ops-pay-table">
            <caption className="ops-visually-hidden">Acerto por motoboy</caption>
            <thead>
              <tr><th scope="col">Motoboy</th><th scope="col">Entregas</th><th scope="col">Encosta</th><th scope="col">Entregas (R$)</th><th scope="col">Total</th></tr>
            </thead>
            <tbody>
              {pay.couriers.map(courier => (
                <tr key={courier.name}>
                  <th scope="row" dir="auto">{courier.name}</th>
                  <td>{courier.deliveries}</td>
                  <td>{formatCents(courier.shiftFeeCents)}</td>
                  <td>{formatCents(courier.deliveryFeesCents)}</td>
                  <td><strong>{formatCents(courier.totalCents)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {/* Same five cells as the rows, so hiding columns on phones keeps the total under "Total". */}
              <tr><th scope="row" colSpan={2}>Total do dia</th><td /><td /><td><strong>{formatCents(total)}</strong></td></tr>
            </tfoot>
          </table>
        ))}
    </dialog>
  </>);
}
