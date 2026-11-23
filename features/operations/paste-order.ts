// "Colar pedido": reads an order pasted from WhatsApp, a delivery app or a receipt and fills the form.
// Pure and forgiving: it only fills what it recognizes, never guesses a phone or invents an address,
// and the store still confirms the address on the map. Nothing here leaves the browser.

export type PastedOrder = {
  customer?: string; phone?: string; address?: string; neighborhood?: string;
  complement?: string; reference?: string; notes?: string;
};

type Field = keyof PastedOrder | "landmark";

// A label may come with its value on the same line or alone ("Telefone:"), the value on the next lines.
const LABELS: { field: Field; pattern: RegExp }[] = [
  { field: "customer", pattern: /^(?:nome(?: do cliente)?|cliente|destinat[aá]rio|para)\s*[:\-–]\s*(.*)$/i },
  { field: "phone", pattern: /^(?:telefone|tel|fone|celular|cel|whats(?:app)?|zap|contato)\s*[:\-–]\s*(.*)$/i },
  { field: "address", pattern: /^(?:endere[cç]o(?: de entrega)?|end|entregar em|local de entrega|entrega)\s*[.:\-–]+\s*(.*)$/i },
  { field: "neighborhood", pattern: /^bairro\s*[:\-–]\s*(.*)$/i },
  { field: "complement", pattern: /^(?:complemento|compl|apto|apartamento)\s*[.:\-–]+\s*(.*)$/i },
  { field: "landmark", pattern: /^(?:ponto de )?refer[eê]ncia\s*[:\-–]\s*(.*)$/i },
  { field: "notes", pattern: /^(?:observa[cç](?:[oõ]es|[aã]o)|obs)\s*[.:\-–]+\s*(.*)$/i },
  { field: "reference", pattern: /^(?:pedido|n[ºo°]\.? do pedido|n[uú]mero do pedido|c[oó]digo)\s*[:\-–#nº°]*\s*#?\s*([A-Za-z0-9-]{1,40})\b/i },
];

const STREET = /^(?:rua|r\.|av\.?|avenida|alameda|al\.|travessa|tv\.|estrada|est\.|rodovia|rod\.|pra[cç]a|p[cç]a\.?|largo|via|viela)\s+\S/i;
const COMPLEMENT = /\b(?:apto?\.?|apartamento|bloco|bl\.?|casa|fundos|sala|lote|qd\.?|quadra|torre)\b/i;

/**
 * Narrow paper (a 58 mm printer has 32 letters a line) or a printing program wraps a long value onto
 * the next lines: "Endereço: rua" / "jovino antonio" / "santana, 329". At most this many lines are
 * joined back to each field.
 */
const WRAPPED_LINES: Partial<Record<Field, number>> = {
  customer: 2, phone: 1, address: 3, neighborhood: 1, complement: 2, landmark: 2, notes: 4,
};
/** A line that never continues a field: a separator, money, items, totals, a date or a time. */
const ENDS_FIELD = /^[-=_*.·•\s]{3,}$|r\$|^\d+\s*x\b|\b\d+\s*x\s|\b(?:sub)?total\b|pagamento|troco|taxa|\d{1,2}\/\d{1,2}\/\d{2,4}|\b\d{1,2}:\d{2}\b/i;
const LETTERS = /^[\p{L}][\p{L}' .-]*$/u;

/** Whether [line], with no label of its own, carries on the [field] whose value so far is [value]. */
function continues(field: Field, value: string, line: string): boolean {
  if (field === "phone") return !value && findMobile(line) !== null;
  if (ENDS_FIELD.test(line) || findMobile(line)) return false;
  switch (field) {
    // A name wraps into more name: letters only, never a street.
    case "customer": return LETTERS.test(line) && !STREET.test(line) && `${value} ${line}`.trim().split(/\s+/).length <= 6;
    case "neighborhood": return LETTERS.test(line);
    // Before the house number anything carries on the street; after it, only a number or one word
    // (the city). Two words after the number may be a name or the bairro without a label: left alone.
    case "address": return !/\d/.test(value) || /\d/.test(line) || /^[\p{L}][\p{L}'.-]*$/u.test(line);
    default: return true;
  }
}

/** "…santana, 329" + "itatiba" → "…santana, 329, itatiba"; otherwise a space. */
const joinWrapped = (value: string, line: string) =>
  !value ? line : /\d$/.test(value) && /^\p{L}/u.test(line) ? `${value}, ${line}` : `${value} ${line}`;

/** A Brazilian mobile number anywhere in [text], as typed digits "11987654321"; null when there is none. */
export function findMobile(text: string): string | null {
  for (const match of text.matchAll(/(?:\+?55[\s.-]*)?\(?\s*([1-9][1-9])\s*\)?[\s.-]*(9[\s.-]*\d{4})[\s.-]*(\d{4})\b/g)) {
    const digits = `${match[1]}${match[2].replace(/\D/g, "")}${match[3]}`;
    if (/^[1-9][1-9]9\d{8}$/.test(digits)) return digits;
  }
  return null;
}

/** "Rua X, 120 - Apto 3" → address "Rua X, 120", complement "Apto 3". */
function splitComplement(address: string): { address: string; complement?: string } {
  const parts = address.split(/\s+[-–]\s+|\s*;\s*/);
  if (parts.length > 1 && COMPLEMENT.test(parts.slice(1).join(" ")))
    return { address: parts[0].trim(), complement: parts.slice(1).join(" - ").trim() };
  return { address: address.trim() };
}

const clean = (value: string) => value.replace(/\s+/g, " ").replace(/^[*_~\s]+|[*_~\s]+$/g, "").trim();

export function parsePastedOrder(text: string): { order: PastedOrder; found: (keyof PastedOrder)[] } {
  const order: PastedOrder = {};
  const extra: string[] = [];
  let landmark = "";
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const leftovers: string[] = [];
  // Each labeled value, with the wrapped lines that carry it on joined back.
  const entries: { field: Field; value: string }[] = [];
  let open: { field: Field; value: string; left: number } | null = null;
  for (const line of lines) {
    const label = LABELS.find(item => item.pattern.test(line));
    if (!label) {
      if (open && open.left > 0 && continues(open.field, open.value, line)) {
        open.value = joinWrapped(open.value, line);
        open.left -= 1;
      } else { leftovers.push(line); open = null; }
      continue;
    }
    open = { field: label.field, value: clean(line.match(label.pattern)![1]), left: WRAPPED_LINES[label.field] ?? 0 };
    entries.push(open);
  }
  for (const { field, value: raw } of entries) {
    const value = clean(raw);
    if (!value) continue;
    if (field === "landmark") { landmark = value; continue; }
    if (field === "phone") { const phone = findMobile(value); if (phone) order.phone = phone; continue; }
    if (field === "notes" && order.notes) { extra.push(value); continue; }
    if (!order[field]) order[field] = value;
  }

  // Without labels: the first street line is the address, a mobile anywhere is the phone, "#1234" the order.
  if (!order.address) {
    const street = leftovers.find(line => STREET.test(line));
    if (street) { order.address = street; leftovers.splice(leftovers.indexOf(street), 1); }
  }
  if (!order.phone) {
    const phone = findMobile(text);
    if (phone) order.phone = phone;
  }
  if (!order.reference) {
    const reference = text.match(/#\s?([A-Za-z0-9-]{2,40})\b/);
    if (reference) order.reference = reference[1];
  }
  // A short line of letters only, before anything else, reads as the customer's name.
  if (!order.customer) {
    const name = leftovers.find(line => /^[\p{L}][\p{L}' .-]{1,60}$/u.test(line) && line.split(" ").length <= 5
      && !STREET.test(line) && !COMPLEMENT.test(line) && !/pedido|entrega|total|pagamento|troco|r\$/i.test(line));
    if (name) order.customer = name;
  }
  if (order.address) {
    const split = splitComplement(order.address);
    order.address = split.address;
    if (split.complement && !order.complement) order.complement = split.complement;
  }
  if (landmark) order.complement = order.complement ? `${order.complement} · ${landmark}` : landmark;
  if (extra.length) order.notes = [order.notes, ...extra].filter(Boolean).join(" · ");

  // Field limits of the form.
  const limits: Record<keyof PastedOrder, number> = {
    customer: 120, phone: 24, address: 200, neighborhood: 120, complement: 240, reference: 40, notes: 500,
  };
  for (const key of Object.keys(order) as (keyof PastedOrder)[]) order[key] = order[key]!.slice(0, limits[key]);
  const found = (["customer", "phone", "address", "neighborhood", "complement", "reference", "notes"] as const)
    .filter(key => !!order[key]);
  return { order, found };
}

const NAMES: Record<keyof PastedOrder, string> = {
  customer: "nome", phone: "WhatsApp", address: "endereço", neighborhood: "bairro",
  complement: "complemento", reference: "nº do pedido", notes: "observações",
};
/** "nome, WhatsApp e endereço". */
export function foundText(found: (keyof PastedOrder)[]): string {
  const words = found.map(key => NAMES[key]);
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} e ${words[words.length - 1]}`;
}
