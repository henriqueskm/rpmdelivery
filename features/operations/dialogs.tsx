import { useRef, useState, type FormEvent, type RefObject } from "react";
import { formatBrazilianMobilePhone, isValidBrazilianMobilePhone } from "@/lib/brazilian-mobile-phone";
import { getSupabase } from "@/lib/supabase/client";
import { foundText, parsePastedOrder, type PastedOrder } from "./paste-order";
import { type DemoOrder, type NewOrder } from "./model";
import { localDateTime, parseLocalDateTime, MAX_PROMISE_MINUTES } from "./deadlines";
import { AddressAutocomplete, type AddressHints } from "@/components/address-autocomplete";
import type { ResolvedAddress } from "@/services/geocoding/types";
import type { IncomingOrder } from "./live/printed-order";
import { readPayment, type PaymentDraft } from "./payment";
import { PaymentFields, draftPaymentFields, readPaymentFields } from "./payment-fields";

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

/** What a form starts with: an order being edited, a returning customer or a pasted order. */
export type OrderPrefill = Partial<Pick<DemoOrder, "customer" | "phone" | "address" | "neighborhood" | "complement"
  | "reference" | "notes" | "orderedAt" | "promisedMinutes">> & {
  /** How the customer pays, maybe only in part (read from a receipt or a message). */
  payment?: PaymentDraft;
  /** Already confirmed on the map (a returning customer's last address). */
  confirmedAddress?: ResolvedAddress;
  /** Search the address right away (pasted text). */
  searchAddress?: boolean;
};

/** A customer who already ordered from this store (find_customer). */
export type KnownCustomer = {
  name: string; address: string; neighborhood: string | null; complement: string | null;
  location: { latitude: number; longitude: number; providerId: string } | null;
  orders: number;
};

function parseCustomer(value: unknown): KnownCustomer | null {
  const c = value as KnownCustomer | null;
  if (!c || typeof c.name !== "string" || typeof c.address !== "string" || !Number.isInteger(c.orders)) return null;
  const location = c.location && typeof c.location.latitude === "number" && typeof c.location.longitude === "number"
    && typeof c.location.providerId === "string" ? c.location : null;
  return { name: c.name, address: c.address, orders: c.orders, location,
    neighborhood: typeof c.neighborhood === "string" ? c.neighborhood : null,
    complement: typeof c.complement === "string" ? c.complement : null };
}

/** Real data: the store's last order for this WhatsApp; null when none or unavailable. */
async function findCustomer(restaurantId: string, phone: string): Promise<KnownCustomer | null> {
  try {
    const { data, error } = await getSupabase().rpc("find_customer", { p_restaurant_id: restaurantId, p_phone: phone });
    return error ? null : parseCustomer(data);
  } catch { return null; }
}

/**
 * The order's fields, for a new order and for editing one still waiting for dispatch. [initial] fills
 * them; mount it again (key) to start over.
 */
function OrderForm({ live, now, defaultPromiseMinutes, initial, submitLabel, footer, onSubmit, onSaved, restaurantId, onRestart, filled }: {
  live: boolean;
  now: number;
  defaultPromiseMinutes: number;
  initial?: OrderPrefill;
  submitLabel: string;
  footer: string;
  onSubmit: Submit;
  onSaved: () => void;
  /** New real order: recognizes a returning customer by the WhatsApp. */
  restaurantId?: string;
  /** New real order: starts the form again with these values ("Colar pedido", returning customer). */
  onRestart?: (prefill: OrderPrefill, filled: string) => void;
  /** What the last restart filled, said once on top of the form. */
  filled?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteError, setPasteError] = useState("");
  const [customer, setCustomer] = useState<KnownCustomer | null>(null);
  const lookedUp = useRef("");
  // Real data: an address picked from the search carries its coordinates.
  const [geocode, setGeocode] = useState<ResolvedAddress | null>(initial?.confirmedAddress ?? null);

  /** What is typed now, so a restart keeps it. */
  function current(): OrderPrefill {
    const data = new FormData(formRef.current!);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const orderedAt = parseLocalDateTime(value("orderedAt"));
    const promisedMinutes = Number(value("promisedMinutes"));
    const payment = draftPaymentFields(data);
    return {
      customer: value("customer"), phone: value("phone"), address: value("address"), neighborhood: value("neighborhood"),
      complement: value("complement"), reference: value("reference"), notes: value("notes"),
      ...(Number.isFinite(orderedAt) ? { orderedAt } : {}), ...(promisedMinutes > 0 ? { promisedMinutes } : {}),
      ...(geocode ? { confirmedAddress: geocode } : {}), ...(payment ? { payment } : {}),
    };
  }
  async function checkPhone(value: string) {
    if (!restaurantId) return;
    const digits = value.replace(/[^0-9]/g, "");
    if (!isValidBrazilianMobilePhone(value)) { lookedUp.current = ""; setCustomer(null); return; }
    if (digits === lookedUp.current) return;
    lookedUp.current = digits;
    const found = await findCustomer(restaurantId, value);
    if (lookedUp.current === digits) setCustomer(found);
  }
  function fillCustomer(known: KnownCustomer) {
    const location: ResolvedAddress | undefined = known.location ? {
      address: known.address, latitude: known.location.latitude, longitude: known.location.longitude,
      provider: "mapbox", providerId: known.location.providerId, ...(known.neighborhood ? { neighborhood: known.neighborhood } : {}),
    } : undefined;
    const typed = current();
    delete typed.confirmedAddress;
    onRestart?.({ ...typed, customer: known.name, address: known.address, neighborhood: known.neighborhood ?? "",
      complement: known.complement ?? "", ...(location ? { confirmedAddress: location } : { searchAddress: true }) },
      `Dados de ${known.name} preenchidos. Confira se o endereço continua o mesmo.`);
  }
  function fillFromPaste() {
    const pasted = pasteRef.current?.value ?? "";
    const { order: read, found } = parsePastedOrder(pasted);
    const payment = readPayment(pasted);
    // The city has no field of its own: it already went to the end of the address.
    const order = Object.fromEntries(Object.entries(read).filter(([key]) => key !== "city")) as Omit<PastedOrder, "city">;
    if (!found.length) {
      setPasteError("Não reconheci nome, WhatsApp nem endereço nesse texto. Confira o que foi colado ou preencha à mão.");
      return;
    }
    const typed = current();
    // What was typed stays where the text says nothing; a pasted address replaces the confirmed one.
    const keep = Object.fromEntries(Object.entries(typed).filter(([key, value]) =>
      value !== "" && !(key in order) && !(order.address && key === "confirmedAddress"))) as OrderPrefill;
    onRestart?.({ ...keep, ...order, ...(order.phone ? { phone: formatBrazilianMobilePhone(order.phone) } : {}),
      ...(order.address ? { searchAddress: true } : {}), ...(payment ? { payment } : {}) },
      `Preenchido: ${foundText(found)}.${payment ? " Pagamento lido do texto: confira abaixo." : ""}${order.address ? " Escolha o endereço na lista para confirmar no mapa." : ""}`);
  }
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
    const payment = readPaymentFields(form);
    if (payment === false) return;
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
      payment,
      geocode: live && geocode
        ? { latitude: geocode.latitude, longitude: geocode.longitude, providerId: geocode.providerId } : undefined,
    }, value("address") !== (initial?.address ?? "").trim());
    setSaving(false);
    if (!saved) { setError(live ? "Não foi possível salvar. Confira os dados e tente de novo." : "Confira o horário original e o prazo prometido."); return; }
    onSaved();
  }
  return (
    <form ref={formRef} onSubmit={submit} onInput={() => setError("")} className="ops-order-form">
      {filled && <p className="ops-form-wide ops-quick-filled" role="status">{filled}</p>}
      {onRestart && (pasting ? (
        <div className="ops-form-wide ops-paste">
          <label>Cole o pedido aqui
            <textarea ref={pasteRef} rows={5} maxLength={4000} autoFocus onInput={() => setPasteError("")}
              placeholder="Texto do WhatsApp, do app de entrega ou do cupom: nome, celular, endereço, bairro…" />
          </label>
          {pasteError && <p role="alert">{pasteError}</p>}
          <div className="ops-paste-actions">
            <button type="button" className="ops-primary" onClick={fillFromPaste}>Preencher com o texto</button>
            <button type="button" className="ops-link-button" onClick={() => { setPasting(false); setPasteError(""); }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" className="ops-form-wide ops-paste-open" onClick={() => setPasting(true)}>
          Colar pedido (WhatsApp, app ou cupom)
        </button>
      ))}
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
          onInput={event => { phoneRef.current?.setCustomValidity(""); void checkPhone(event.currentTarget.value); }}
        />
      </label>
      <label>
        Nome do cliente
        <input name="customer" required maxLength={120} autoComplete="off" defaultValue={initial?.customer} />
      </label>
      {customer && (
        <div className="ops-form-wide ops-known-customer" role="status">
          <p>
            <strong>Já pediu aqui {customer.orders === 1 ? "1 vez" : `${customer.orders} vezes`}.</strong>{" "}
            <span dir="auto">{customer.name}</span> · <span dir="auto">{customer.address}</span>
            {customer.neighborhood && <> · <span dir="auto">{customer.neighborhood}</span></>}
          </p>
          <button type="button" onClick={() => fillCustomer(customer)}>Usar estes dados</button>
        </div>
      )}
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
          hints={ORDER_ADDRESS_HINTS} initialQuery={initial?.address} initialAddress={initial?.confirmedAddress}
          autoSearch={initial?.searchAddress} />
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
      <PaymentFields initial={initial?.payment} required={live} />
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
  restaurantId,
  incoming,
  onIncomingSaved,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  onAdd: (order: NewOrder) => boolean | Promise<boolean>;
  now: number;
  defaultPromiseMinutes: number;
  /** Real data: the order is saved and the customer gets the tracking link. */
  live?: boolean;
  /** Real data: returning customers are recognized by the WhatsApp. */
  restaurantId?: string;
  /** Real data: an order read from a printed receipt; a new object fills the form again. */
  incoming?: IncomingOrder | null;
  /** The incoming order was saved (or was already there). */
  onIncomingSaved?: (id: string) => void;
}) {
  // A saved order starts the next one from an empty form; a paste or a returning customer refills it.
  const [formKey, setFormKey] = useState(0);
  const [prefill, setPrefill] = useState<{ values: OrderPrefill; filled: string } | null>(null);
  // The printed order the form holds. Closing without saving lets it go: it stays on the banner.
  const [held, setHeld] = useState<IncomingOrder | null>(null);
  const [seen, setSeen] = useState<IncomingOrder | null>(null);
  if (incoming && incoming !== seen) {
    setSeen(incoming);
    setHeld(incoming);
    setPrefill({ values: incoming.values, filled: incoming.filled });
    setFormKey(key => key + 1);
  }
  function letGo() {
    if (!held) return;
    setHeld(null); setPrefill(null); setFormKey(key => key + 1);
  }
  return (
    <dialog ref={dialogRef} className="ops-dialog" aria-labelledby="ops-new-title" onClose={letGo}>
      <div className="ops-dialog-heading">
        <div>
          <span className="ops-kicker">{held ? "PEDIDO DA IMPRESSORA" : live ? "NOVO PEDIDO" : "CADASTRO DEMONSTRATIVO"}</span>
          <h2 id="ops-new-title">Novo pedido</h2>
        </div>
        <button type="button" aria-label="Fechar novo pedido" onClick={() => dialogRef.current?.close()}>×</button>
      </div>
      <p className="ops-dialog-notice">
        {held ? "Confira o que foi lido do cupom. O cliente recebe o link de acompanhamento quando a rota sair."
          : live ? "O cliente recebe o link de acompanhamento quando a rota sair."
          : "Use apenas dados fictícios. Nada será salvo ou enviado."}
      </p>
      <OrderForm key={formKey} live={live} now={now} defaultPromiseMinutes={defaultPromiseMinutes}
        submitLabel={live ? "Cadastrar pedido" : "Cadastrar pedido (demo)"} footer="Entra em Aguardando despacho."
        initial={prefill?.values} filled={prefill?.filled}
        restaurantId={live ? restaurantId : undefined}
        onRestart={live ? (values, filled) => { setPrefill({ values, filled }); setFormKey(key => key + 1); } : undefined}
        onSubmit={order => onAdd(held ? { ...order, origin: held.origin } : order)}
        onSaved={() => {
          const saved = held?.id;
          dialogRef.current?.close(); setHeld(null); setPrefill(null); setFormKey(key => key + 1);
          if (saved) onIncomingSaved?.(saved);
        }} />
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
