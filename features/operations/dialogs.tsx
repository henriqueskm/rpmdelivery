import { useRef, useState, type FormEvent, type RefObject } from "react";
import { isValidBrazilianMobilePhone } from "@/lib/brazilian-mobile-phone";
import { type DemoOrder, type NewOrder } from "./model";
import { localDateTime, parseLocalDateTime, MAX_PROMISE_MINUTES } from "./deadlines";
import { AddressAutocomplete, type AddressHints } from "@/components/address-autocomplete";
import type { ResolvedAddress } from "@/services/geocoding/types";

// A customer's address may be saved as typed: the search helps, it never blocks the order.
const ORDER_ADDRESS_HINTS: AddressHints = {
  idle: "Comece pelo nome da rua e escolha na lista: o cliente vê a casa no mapa. Sem escolher, o pedido é salvo só com o texto.",
  results: "Escolha o endereço na lista.",
  empty: "Nenhum endereço encontrado. Dá para salvar só com o texto.",
  error: "Não foi possível buscar agora. Dá para salvar só com o texto.",
  confirmed: "Localização confirmada: o cliente vê a casa no mapa. Ao editar, escolha de novo.",
};

/** What the form hands over: the order, and whether its address text changed (editing keeps the pin otherwise). */
type Submit = (order: NewOrder, addressChanged: boolean) => boolean | Promise<boolean>;

/**
 * The order's fields, for a new order and for editing one still waiting for dispatch. [initial] fills
 * them; mount it again (key) to start over.
 */
function OrderForm({ live, now, defaultPromiseMinutes, initial, submitLabel, footer, onSubmit, onSaved }: {
  live: boolean;
  now: number;
  defaultPromiseMinutes: number;
  initial?: DemoOrder;
  submitLabel: string;
  footer: string;
  onSubmit: Submit;
  onSaved: () => void;
}) {
  const phoneRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Real data: an address picked from the search carries its coordinates.
  const [geocode, setGeocode] = useState<ResolvedAddress | null>(null);
  // The bairro found with the address fills the field, unless the store already typed another one.
  const neighborhoodRef = useRef<HTMLInputElement>(null);
  const autoNeighborhood = useRef("");
  function pickAddress(address: ResolvedAddress | null) {
    setGeocode(address);
    const field = neighborhoodRef.current;
    if (!field) return;
    // A bairro the store typed stays. One the search filled follows the address: a new address
    // brings its bairro, or clears it when none was found (never the previous street's).
    if (field.value.trim() && field.value !== autoNeighborhood.current) return;
    const next = address?.neighborhood ?? "";
    field.value = next;
    autoNeighborhood.current = next;
  }
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
    const saved = await onSubmit({
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
    }, value("address") !== (initial?.address ?? "").trim());
    setSaving(false);
    if (!saved) { setError(live ? "Não foi possível salvar. Confira os dados e tente de novo." : "Confira o horário original e o prazo prometido."); return; }
    onSaved();
  }
  return (
    <form onSubmit={submit} onInput={() => setError("")} className="ops-order-form">
      <label>
        Nome do cliente
        <input name="customer" required maxLength={120} autoComplete="off" defaultValue={initial?.customer} />
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
          defaultValue={initial?.phone}
          onInput={() => phoneRef.current?.setCustomValidity("")}
        />
      </label>
      <label>Pedido feito em
        <input name="orderedAt" type="datetime-local" required max={localDateTime(now)}
          defaultValue={localDateTime(initial?.orderedAt ?? now)} />
      </label>
      <label>Prazo prometido (minutos)
        <input name="promisedMinutes" type="number" inputMode="numeric" required min={1} max={MAX_PROMISE_MINUTES} step={1}
          defaultValue={initial?.promisedMinutes ?? defaultPromiseMinutes} />
      </label>
      <p className="ops-form-wide ops-deadline-help">Conte a partir do horário original do pedido, mesmo se recebido antes do cadastro. Horários deste dispositivo; sem previsão de chegada.</p>
      {live ? (
        <AddressAutocomplete onChange={pickAddress} className="ops-form-wide ops-order-address"
          placeholder="Nome da rua e número" mapAlt="Mapa do endereço do cliente, com marcador"
          hints={ORDER_ADDRESS_HINTS} initialQuery={initial?.address} />
      ) : (
        <label className="ops-form-wide">
          Endereço
          <input name="address" required maxLength={240} autoComplete="off" placeholder="Rua e número"
            defaultValue={initial?.address} />
        </label>
      )}
      <label>
        Bairro
        <input name="neighborhood" ref={neighborhoodRef} required maxLength={120} autoComplete="off"
          defaultValue={initial?.neighborhood} />
      </label>
      <label>
        Nº do pedido (opcional)
        <input name="reference" maxLength={40} autoComplete="off" placeholder="Como no cupom ou no app"
          defaultValue={initial?.reference} />
      </label>
      <label className="ops-form-wide">
        Complemento / referência
        <input name="complement" maxLength={240} autoComplete="off" placeholder="Apartamento, portaria ou ponto de referência"
          defaultValue={initial?.complement} />
      </label>
      <label className="ops-form-wide">
        Observações
        <textarea name="notes" rows={3} maxLength={500} placeholder="O que o motoboy precisa saber?"
          defaultValue={initial?.notes} />
      </label>
      <div className="ops-form-wide ops-form-footer">
        <span>{footer}</span>
        <button type="submit" className="ops-primary">{saving ? "Salvando…" : submitLabel}</button>
      </div>
      {error && <p className="ops-form-wide" role="alert">{error}</p>}
    </form>
  );
}

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
  // A saved order starts the next one from an empty form.
  const [formKey, setFormKey] = useState(0);
  return (
    <dialog ref={dialogRef} className="ops-dialog" aria-labelledby="ops-new-title">
      <div className="ops-dialog-heading">
        <div>
          <span className="ops-kicker">{live ? "NOVO PEDIDO" : "CADASTRO DEMONSTRATIVO"}</span>
          <h2 id="ops-new-title">Novo pedido</h2>
        </div>
        <button type="button" aria-label="Fechar novo pedido" onClick={() => dialogRef.current?.close()}>×</button>
      </div>
      <p className="ops-dialog-notice">
        {live ? "O cliente recebe o link de acompanhamento quando a rota sair."
          : "Use apenas dados fictícios. Nada será salvo ou enviado."}
      </p>
      <OrderForm key={formKey} live={live} now={now} defaultPromiseMinutes={defaultPromiseMinutes}
        submitLabel={live ? "Cadastrar pedido" : "Cadastrar pedido (demo)"} footer="Entra em Aguardando despacho."
        onSubmit={order => onAdd(order)}
        onSaved={() => { dialogRef.current?.close(); setFormKey(key => key + 1); }} />
    </dialog>
  );
}

/**
 * Real data: fixes an order still waiting for dispatch (wrong number, new address, a note). Once in a
 * route the order is fixed: the courier already has it. Keeping the address keeps its map pin.
 */
export function EditOrderDialog({ dialogRef, order, now, defaultPromiseMinutes, onSave, onClose }: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  order: DemoOrder | undefined;
  now: number;
  defaultPromiseMinutes: number;
  onSave: (id: string, order: NewOrder, keepLocation: boolean) => boolean | Promise<boolean>;
  onClose: () => void;
}) {
  return (
    <dialog ref={dialogRef} className="ops-dialog" aria-labelledby="ops-edit-title" onClose={onClose}>
      <div className="ops-dialog-heading">
        <div>
          <span className="ops-kicker">AGUARDANDO DESPACHO</span>
          <h2 id="ops-edit-title">Editar pedido{order ? ` #${order.reference}` : ""}</h2>
        </div>
        <button type="button" aria-label="Fechar edição do pedido" onClick={() => dialogRef.current?.close()}>×</button>
      </div>
      <p className="ops-dialog-notice">Dá para editar até o pedido entrar em uma rota.</p>
      {order && <OrderForm key={order.id} live now={now} defaultPromiseMinutes={defaultPromiseMinutes} initial={order}
        submitLabel="Salvar alterações" footer="Continua em Aguardando despacho."
        onSubmit={(next, addressChanged) => onSave(order.id, next, !addressChanged && !next.geocode)}
        onSaved={() => dialogRef.current?.close()} />}
    </dialog>
  );
}
