"use client";

import { useCallback, useImperativeHandle, useRef, useState, type Ref } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { errorMessage } from "./commands";
import { formatCents } from "./pay";
import {
  closeQuestion, dayTime, ordersLine, parseDayClose, parseDayReport, shiftLine, type DayClose as DayCloseData, type DayReport,
} from "./day-close";

export type DayCloseHandle = { open: () => void };

/**
 * "Fechar o dia": ends every courier's shift (those out on a route go on until they come back) and
 * saves the report of the period since the last close: deliveries, what each courier collected at
 * the door and is paid, and what happened to the orders. Past closes stay readable.
 */
export function DayClose({ restaurantId, ref, trigger = true, onClosed }: {
  restaurantId: string;
  ref?: Ref<DayCloseHandle>;
  /** False: no button, opened only through [ref] (the store menu). */
  trigger?: boolean;
  /** The board changed (shifts ended): refresh it. */
  onClosed?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<DayCloseData | null>(null);
  /** A saved report on screen: the one just closed or one picked from the list. */
  const [saved, setSaved] = useState<{ id: string; closedAt: string; report: DayReport } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    const { data: answer, error: failure } = await getSupabase().rpc("get_day_close", { p_restaurant_id: restaurantId });
    if (failure) { setError(errorMessage(failure)); return; }
    try { setData(parseDayClose(answer)); }
    catch { setError("O painel recebeu uma resposta inesperada. Tente de novo."); }
  }, [restaurantId]);

  function open() {
    setSaved(null); setConfirming(false); setError(""); requestId.current = null;
    dialogRef.current?.showModal();
    void load();
  }
  useImperativeHandle(ref, () => ({ open }));

  async function close() {
    if (busy) return;
    setBusy(true); setError("");
    // The same id if the answer is lost and the store presses again: one close, never two.
    requestId.current ??= crypto.randomUUID();
    const { data: answer, error: failure } = await getSupabase().rpc("close_store_day",
      { p_restaurant_id: restaurantId, p_request_id: requestId.current });
    setBusy(false);
    if (failure) { setError(errorMessage(failure)); return; }
    try {
      const reply = answer as { closeId: string; report: unknown };
      const report = parseDayReport(reply.report);
      setSaved({ id: reply.closeId, closedAt: report.periodEnd, report });
      setConfirming(false); requestId.current = null;
      onClosed?.();
      void load();
    } catch { setError("O painel recebeu uma resposta inesperada. Tente de novo."); }
  }

  async function show(id: string) {
    const entry = data?.closes.find(item => item.id === id);
    if (!entry) { setSaved(null); return; }
    setError("");
    const { data: answer, error: failure } = await getSupabase().rpc("get_day_close_report",
      { p_restaurant_id: restaurantId, p_close_id: id });
    if (failure) { setError(errorMessage(failure)); return; }
    try { setSaved({ id, closedAt: entry.closedAt, report: parseDayReport(answer) }); }
    catch { setError("O painel recebeu uma resposta inesperada. Tente de novo."); }
  }

  const last = data?.closes[0];
  return (<>
    {trigger && <button type="button" className="text-button" onClick={open}>Fechar o dia</button>}
    <dialog ref={dialogRef} className="ops-dialog ops-pay-dialog ops-day-dialog" aria-labelledby="ops-day-title"
      onClose={() => { setConfirming(false); setError(""); }}>
      <div className="ops-dialog-heading">
        <div>
          <span className="ops-kicker">FECHAMENTO</span>
          <h2 id="ops-day-title">Fechar o dia</h2>
        </div>
        <button type="button" aria-label="Fechar o fechamento do dia" onClick={() => dialogRef.current?.close()}>×</button>
      </div>

      {error && <p className="ops-pay-error" role="alert">{error}</p>}

      {data && (data.closes.length > 0) && (
        <div className="ops-pay-day">
          <label>Relatório
            <select value={saved?.id ?? ""} onChange={event => void show(event.target.value)}>
              <option value="">Desde o último fechamento (agora)</option>
              {data.closes.map(entry => (
                <option key={entry.id} value={entry.id}>Fechado em {dayTime(entry.closedAt)} por {entry.closedBy}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {saved ? (
        <>
          <p className="ops-pay-notice" role="status">
            Dia fechado em {dayTime(saved.closedAt)}.
            {saved.report.endedShifts?.length ? ` Turnos encerrados: ${saved.report.endedShifts.join(", ")}.` : ""}
            {saved.report.stillOut?.length ? ` Ainda em rota: ${saved.report.stillOut.join(", ")} (o turno continua até voltar).` : ""}
          </p>
          <ReportView report={saved.report} />
          <div className="ops-day-actions">
            <button type="button" className="ops-link-button" onClick={() => window.print()}>Imprimir relatório</button>
          </div>
        </>
      ) : data && (
        <>
          <section className="ops-day-shifts" aria-labelledby="ops-day-shifts-title">
            <h3 id="ops-day-shifts-title">Turnos abertos</h3>
            {data.openShifts.length === 0 ? <p className="ops-pay-empty">Nenhum motoboy em turno.</p> : (
              <ul>
                {data.openShifts.map(shift => (
                  <li key={shift.shiftId} className={shift.onRoute ? "is-out" : ""}>
                    <strong dir="auto">{shift.name}</strong> <span>{shiftLine(shift)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="ops-day-period">
            {last ? `Desde o último fechamento, em ${dayTime(last.closedAt)}.` : "Últimas 24 horas (primeiro fechamento da loja)."}
          </p>
          <ReportView report={data.preview} />
          <div className="ops-day-actions">
            {confirming ? (
              <div className="ops-day-confirm" role="group" aria-label="Confirmar o fechamento do dia">
                <p>{closeQuestion(data.openShifts)}</p>
                <button type="button" className="ops-primary" disabled={busy} onClick={() => void close()}>
                  {busy ? "Fechando…" : "Sim, fechar o dia"}
                </button>
                <button type="button" className="ops-link-button" disabled={busy} onClick={() => setConfirming(false)}>Voltar</button>
              </div>
            ) : (
              <button type="button" className="ops-primary" onClick={() => setConfirming(true)}>
                Encerrar turnos e fechar o dia
              </button>
            )}
          </div>
        </>
      )}
    </dialog>
  </>);
}

/** The report: orders, then each courier with what they collected and are paid. */
function ReportView({ report }: { report: DayReport }) {
  const sum = (pick: (courier: DayReport["couriers"][number]) => number) => report.couriers.reduce((total, c) => total + pick(c), 0);
  return (
    <div className="ops-day-report">
      <p className="ops-day-summary">{ordersLine(report.orders)}</p>
      {report.couriers.length === 0 ? <p className="ops-pay-empty">Nenhuma entrega neste período.</p> : (
        <div className="ops-day-table-wrap" tabIndex={0} aria-label="Relatório por motoboy">
          <table className="ops-day-table">
            <caption className="ops-visually-hidden">Entregas, cobranças e pagamento por motoboy</caption>
            <thead>
              <tr><th scope="col">Motoboy</th><th scope="col">Entregas</th><th scope="col">Dinheiro</th>
                <th scope="col">Cartão</th><th scope="col">Pix</th><th scope="col">A pagar</th></tr>
            </thead>
            <tbody>
              {report.couriers.map(courier => (
                <tr key={courier.name}>
                  <th scope="row" dir="auto">{courier.name}</th>
                  <td>{courier.deliveries}</td>
                  <td>{formatCents(courier.cashCents)}</td>
                  <td>{formatCents(courier.cardCents)}</td>
                  <td>{formatCents(courier.pixCents)}</td>
                  <td><strong>{formatCents(courier.totalCents)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th scope="row">Total</th><td>{sum(c => c.deliveries)}</td><td>{formatCents(sum(c => c.cashCents))}</td>
                <td>{formatCents(sum(c => c.cardCents))}</td><td>{formatCents(sum(c => c.pixCents))}</td>
                <td><strong>{formatCents(sum(c => c.totalCents))}</strong></td></tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="ops-day-help">
        Dinheiro: o motoboy entrega esse valor no caixa. A pagar: encosta mais o valor por entrega.
        {report.payments.paid ? ` ${report.payments.paid === 1 ? "1 entrega já estava paga" : `${report.payments.paid} entregas já estavam pagas`}.` : ""}
        {report.payments.notInformed ? ` ${report.payments.notInformed === 1 ? "1 entrega sem" : `${report.payments.notInformed} entregas sem`} pagamento informado.` : ""}
      </p>
    </div>
  );
}
