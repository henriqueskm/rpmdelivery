import { useEffect, useState, type FormEvent, type RefObject } from "react";
import type { Command, DemoState } from "./model";
import { calendarTime, deadlineAt, localDateTime, parseLocalDateTime, MAX_PROMISE_MINUTES } from "./deadlines";

export function DeadlineDialog({ dialogRef, state, target, onSave, onClose }: {
  dialogRef: RefObject<HTMLDialogElement | null>; state: DemoState;
  target?: string; onSave: (command: Command) => boolean; onClose: () => void;
}) {
  const [error, setError] = useState("");
  const order = state.orders.find(o => o.id === target);
  const defaultMode = target === "default";
  useEffect(() => {
    if (target) {
      dialogRef.current?.showModal();
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    }
  }, [target, dialogRef]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const minutes = Number(data.get("minutes"));
    const saved = defaultMode ? onSave({ type: "default-promise", minutes }) : order && onSave({
      type: "deadline", orderId: order.id, orderedAt: parseLocalDateTime(String(data.get("orderedAt"))), minutes,
    });
    if (saved) dialogRef.current?.close();
    else setError("Confira o horário original e um prazo inteiro entre 1 e 240 minutos.");
  }
  return <dialog ref={dialogRef} className="ops-dialog" aria-label={defaultMode ? "Prazo padrão" : "Editar prazo"} onClose={() => { setError(""); onClose(); }}>
    {target && <>
      <div className="ops-dialog-heading">
        <h2>{defaultMode ? "Prazo padrão" : `Prazo · #${order?.reference}`}</h2>
        <button aria-label="Fechar prazo" onClick={() => dialogRef.current?.close()}>×</button>
      </div>
      <p className="ops-dialog-notice">Demonstração · sem persistência. Prazo prometido; não é previsão de chegada.</p>
      <form key={target} onSubmit={submit} onInput={() => setError("")} className="ops-order-form">
        {order && <>
          <p className="ops-form-wide">{order.customer}<br />Cadastrado em {calendarTime(order.createdAt)} · limite atual {calendarTime(deadlineAt(order))}.</p>
          <label className="ops-form-wide">Pedido feito em
            <input name="orderedAt" type="datetime-local" required defaultValue={localDateTime(order.orderedAt)} max={localDateTime(order.createdAt)} />
          </label>
        </>}
        <label className="ops-form-wide">{defaultMode ? "Prazo padrão (minutos)" : "Prazo prometido (minutos)"}
          <input name="minutes" type="number" inputMode="numeric" required min={1} max={MAX_PROMISE_MINUTES} step={1}
            defaultValue={order?.promisedMinutes ?? state.defaultPromiseMinutes} />
        </label>
        <p className="ops-form-wide ops-deadline-help">{defaultMode
          ? "Vale para novos pedidos. Não altera as promessas já registradas."
          : "O limite é o horário original do pedido mais o prazo prometido, independentemente do cadastro ou da saída da rota."} Horários deste dispositivo.</p>
        <div className="ops-form-wide ops-form-footer">
          <span>Entre 1 e {MAX_PROMISE_MINUTES} minutos.</span>
          <button type="submit" className="ops-primary">Salvar prazo (demo)</button>
        </div>
        {error && <p role="alert" className="ops-form-wide">{error}</p>}
      </form>
    </>}
  </dialog>;
}
