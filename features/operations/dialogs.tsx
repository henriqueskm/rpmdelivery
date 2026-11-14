import { useRef, useState, type FormEvent, type RefObject } from "react";
import { isValidBrazilianMobilePhone } from "@/lib/brazilian-mobile-phone";
import { type NewOrder } from "./model";
import { localDateTime, parseLocalDateTime, MAX_PROMISE_MINUTES } from "./deadlines";
import { AddressAutocomplete, type AddressHints } from "@/components/address-autocomplete";
import type { ResolvedAddress } from "@/services/geocoding/types";

// A customer's address may be saved as typed: the search helps, it never blocks the order.
const ORDER_ADDRESS_HINTS: AddressHints = {
  idle: "Digite rua, número e cidade e escolha na lista: o cliente vê a casa no mapa. Sem escolher, o pedido é salvo só com o texto.",
  results: "Escolha o endereço na lista.",
  empty: "Nenhum endereço encontrado. Dá para salvar só com o texto.",
  error: "Não foi possível buscar agora. Dá para salvar só com o texto.",
  confirmed: "Localização confirmada: o cliente vê a casa no mapa. Ao editar, escolha de novo.",
};

export function NewOrderDialog({
  dialogRef,
  onAdd,
  now,
  defaultPromiseMinutes,
  live = false,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  onAdd: (order: NewOrder) => boolean | Promise<boolean>;
  now: number;
  defaultPromiseMinutes: number;
  /** Real data: the order is saved and the customer gets the tracking link. */
  live?: boolean;
}) {
  const phoneRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Real data: an address picked from the search carries its coordinates; a new form starts empty.
  const [geocode, setGeocode] = useState<ResolvedAddress | null>(null);
  const [formKey, setFormKey] = useState(0);
  async function submit(event: FormEvent<HTMLFormElement>) {
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
        live ? "Informe o celular do cliente com DDD e 9 dígitos." : "Informe um celular fictício com DDD e 9 dígitos.",
      );
      phoneRef.current?.reportValidity();
      return;
    }
    if (saving) return;
    setSaving(true);
    const added = await onAdd({
      reference: value("reference"),
      customer: value("customer"),
      phone: value("phone"),
      address: value("address"),
      neighborhood: value("neighborhood"),
      complement: value("complement"),
      notes: value("notes"),
      orderedAt: parseLocalDateTime(value("orderedAt")),
      promisedMinutes: Number(value("promisedMinutes")),
      geocode: live && geocode
        ? { latitude: geocode.latitude, longitude: geocode.longitude, providerId: geocode.providerId } : undefined,
    });
    setSaving(false);
    if (!added) { setError(live ? "Não foi possível salvar. Confira os dados e tente de novo." : "Confira o horário original e o prazo prometido."); return; }
    dialogRef.current?.close();
    form.reset();
    setGeocode(null);
    setFormKey(key => key + 1);
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
          <span className="ops-kicker">{live ? "NOVO PEDIDO" : "CADASTRO DEMONSTRATIVO"}</span>
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
        {live ? "O cliente recebe o link de acompanhamento quando a rota sair."
          : "Use apenas dados fictícios. Nada será salvo ou enviado."}
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
        {live ? (
          <AddressAutocomplete key={formKey} onChange={setGeocode} className="ops-form-wide ops-order-address"
            placeholder="Rua, número e cidade" mapAlt="Mapa do endereço do cliente, com marcador"
            hints={ORDER_ADDRESS_HINTS} />
        ) : (
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
        )}
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
            {live ? saving ? "Salvando…" : "Cadastrar pedido" : "Cadastrar pedido (demo)"}
          </button>
        </div>
        {error && <p className="ops-form-wide" role="alert">{error}</p>}
      </form>
    </dialog>
  );
}
