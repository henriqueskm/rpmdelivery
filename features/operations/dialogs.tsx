import { useRef, useState, type FormEvent, type RefObject } from "react";
import { isValidBrazilianMobilePhone } from "@/lib/brazilian-mobile-phone";
import { type NewOrder } from "./model";
import { localDateTime, parseLocalDateTime, MAX_PROMISE_MINUTES } from "./deadlines";

export function NewOrderDialog({
  dialogRef,
  onAdd,
  now,
  defaultPromiseMinutes,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  onAdd: (order: NewOrder) => boolean;
  now: number;
  defaultPromiseMinutes: number;
}) {
  const phoneRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    for (const name of ["customer", "phone", "address", "neighborhood"]) {
      const field = form.elements.namedItem(name) as HTMLInputElement;
      field.value = value(name);
    }
    if (!form.reportValidity()) return;
    if (!isValidBrazilianMobilePhone(value("phone"))) {
      phoneRef.current?.setCustomValidity(
        "Informe um celular fictício com DDD e 9 dígitos.",
      );
      phoneRef.current?.reportValidity();
      return;
    }
    const added = onAdd({
      reference: value("reference"),
      customer: value("customer"),
      phone: value("phone"),
      address: value("address"),
      neighborhood: value("neighborhood"),
      complement: value("complement"),
      notes: value("notes"),
      orderedAt: parseLocalDateTime(value("orderedAt")),
      promisedMinutes: Number(value("promisedMinutes")),
    });
    if (!added) { setError("Confira o horário original e o prazo prometido."); return; }
    dialogRef.current?.close();
    form.reset();
  }
  return (
    <dialog
      ref={dialogRef}
      className="ops-dialog"
      aria-labelledby="ops-new-title"
      onClose={() => setError("")}
    >
      <div className="ops-dialog-heading">
        <div>
          <span className="ops-kicker">CADASTRO DEMONSTRATIVO</span>
          <h2 id="ops-new-title">Novo pedido</h2>
        </div>
        <button
          type="button"
          aria-label="Fechar novo pedido"
          onClick={() => dialogRef.current?.close()}
        >
          ×
        </button>
      </div>
      <p className="ops-dialog-notice">
        Use apenas dados fictícios. Nada será salvo ou enviado.
      </p>
      <form onSubmit={submit} onInput={() => setError("")} className="ops-order-form">
        <label>
          Nome do cliente
          <input name="customer" required maxLength={120} autoComplete="off" />
        </label>
        <label>
          WhatsApp
          <input
            name="phone"
            ref={phoneRef}
            required
            type="tel"
            inputMode="tel"
            placeholder="(11) 90000-0000"
            maxLength={24}
            autoComplete="off"
            onInput={() => phoneRef.current?.setCustomValidity("")}
          />
        </label>
        <label>Pedido feito em
          <input name="orderedAt" type="datetime-local" required defaultValue={localDateTime(now)} max={localDateTime(now)} />
        </label>
        <label>Prazo prometido (minutos)
          <input name="promisedMinutes" type="number" inputMode="numeric" required min={1} max={MAX_PROMISE_MINUTES} step={1} defaultValue={defaultPromiseMinutes} />
        </label>
        <p className="ops-form-wide ops-deadline-help">Conte a partir do horário original do pedido, mesmo se recebido antes do cadastro. Horários deste dispositivo; sem previsão de chegada.</p>
        <label className="ops-form-wide">
          Endereço
          <input
            name="address"
            required
            maxLength={240}
            autoComplete="off"
            placeholder="Rua e número"
          />
        </label>
        <label>
          Bairro
          <input
            name="neighborhood"
            required
            maxLength={120}
            autoComplete="off"
          />
        </label>
        <label>
          Número / referência (opcional)
          <input name="reference" maxLength={40} autoComplete="off" />
        </label>
        <label className="ops-form-wide">
          Complemento / referência
          <input
            name="complement"
            maxLength={240}
            autoComplete="off"
            placeholder="Apartamento, portaria ou ponto de referência"
          />
        </label>
        <label className="ops-form-wide">
          Observações
          <textarea
            name="notes"
            rows={3}
            maxLength={500}
            placeholder="O que o motoboy precisa saber?"
          />
        </label>
        <div className="ops-form-wide ops-form-footer">
          <span>Entra em Aguardando despacho.</span>
          <button type="submit" className="ops-primary">
            Cadastrar pedido (demo)
          </button>
        </div>
        {error && <p className="ops-form-wide" role="alert">{error}</p>}
      </form>
    </dialog>
  );
}
