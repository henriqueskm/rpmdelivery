import { useState } from "react";
import { METHOD_LABEL, PAYMENT_METHODS, moneyField, parseMoney, type OrderPayment, type PaymentDraft, type PaymentMethod } from "./payment";

/**
 * "Pagamento" in the order form: how the customer pays and, when the courier collects, how much and
 * the change. The values go with the form (paymentMethod, amountDue, changeFor); readPaymentFields reads them.
 * Required with real data: the courier must know at every stop. The demo may leave it out.
 */
export function PaymentFields({ initial, required }: { initial?: PaymentDraft; required: boolean }) {
  const [method, setMethod] = useState<PaymentMethod | undefined>(initial?.method);
  const collect = method !== undefined && method !== "PAID";
  return (
    <fieldset className="ops-form-wide ops-payment">
      <legend>Pagamento</legend>
      <div className="ops-payment-methods">
        {PAYMENT_METHODS.map((value, index) => (
          <label key={value} className={method === value ? "is-checked" : ""}>
            <input type="radio" name="paymentMethod" value={value} required={required && index === 0}
              defaultChecked={initial?.method === value} onChange={() => setMethod(value)} />
            {METHOD_LABEL[value]}
          </label>
        ))}
      </div>
      {collect && (
        <div className="ops-payment-amounts">
          <label>Valor a cobrar (R$)
            <input name="amountDue" required inputMode="decimal" autoComplete="off" placeholder="52,90" maxLength={14}
              defaultValue={moneyField(initial?.amountDueCents)}
              onInput={event => event.currentTarget.setCustomValidity("")} />
          </label>
          {method === "CASH" && (
            <label>Troco para (R$, opcional)
              <input name="changeFor" inputMode="decimal" autoComplete="off" placeholder="100,00" maxLength={14}
                defaultValue={moneyField(initial?.changeForCents)}
                onInput={event => event.currentTarget.setCustomValidity("")} />
            </label>
          )}
        </div>
      )}
      <p className="ops-payment-help">
        {method === "PAID" ? "O motoboy não cobra nada na entrega."
          : method === "CARD" || method === "PIX" ? "O motoboy é avisado para levar a maquininha."
          : method === "CASH" ? "Com troco, o motoboy é avisado para levar o troco."
          : "O motoboy vê em cada entrega se está pago ou quanto cobrar."}
      </p>
    </fieldset>
  );
}

/** What is typed now, even if incomplete (a restart of the form keeps it). */
export function draftPaymentFields(data: FormData): PaymentDraft | undefined {
  const method = PAYMENT_METHODS.find(value => value === data.get("paymentMethod"));
  if (!method) return undefined;
  const due = parseMoney(String(data.get("amountDue") ?? ""));
  const change = parseMoney(String(data.get("changeFor") ?? ""));
  return { method, ...(method !== "PAID" && due ? { amountDueCents: due } : {}),
    ...(method === "CASH" && change ? { changeForCents: change } : {}) };
}

/**
 * The payment to save (undefined when none was chosen, which only the demo allows: the radio is
 * required with real data), or false after marking the field that is wrong (the browser shows why).
 */
export function readPaymentFields(form: HTMLFormElement): OrderPayment | undefined | false {
  const data = new FormData(form);
  const method = PAYMENT_METHODS.find(value => value === data.get("paymentMethod"));
  if (!method) return undefined;
  if (method === "PAID") return { method };
  const dueField = form.elements.namedItem("amountDue") as HTMLInputElement | null;
  const due = parseMoney(dueField?.value ?? "");
  if (!due || due > 10_000_000) {
    dueField?.setCustomValidity("Informe o valor a cobrar do cliente, como 52,90.");
    dueField?.reportValidity();
    return false;
  }
  const changeField = form.elements.namedItem("changeFor") as HTMLInputElement | null;
  const typed = method === "CASH" ? changeField?.value.trim() ?? "" : "";
  if (!typed) return { method, amountDueCents: due };
  const change = parseMoney(typed);
  if (!change || change <= due || change > 10_000_000) {
    changeField?.setCustomValidity("O troco é para uma nota maior que o valor a cobrar, como 100,00. Sem troco, deixe em branco.");
    changeField?.reportValidity();
    return false;
  }
  return { method, amountDueCents: due, changeForCents: change };
}
