// "Colar pedido": reads an order pasted from WhatsApp, a delivery app or a receipt and fills the form.
// Pure and forgiving: it only fills what it recognizes, never guesses a phone or invents an address,
// and the store still confirms the address on the map. Nothing here leaves the browser.

export type PastedOrder = {
  customer?: string; phone?: string; address?: string; neighborhood?: string;
  complement?: string; reference?: string; notes?: string;
  /**
   * The city the receipt names ("Bairro: Centro - Itatiba/SP"). It is not a field of the form: it goes
   * at the end of the address, so the search looks in that city, and the automatic mode only accepts
   * an address found there.
   */
  city?: string;
  /**
   * The delivery app's contact when it hides the customer's mobile: iFood prints the same 0800 for
   * every customer, with the order's ID ("0800 718 2283 · ID 12345678"). Never taken as the mobile.
   */
  contact?: string;
};

type Field = keyof PastedOrder | "landmark";

// A label may come with its value on the same line or alone ("Telefone:"), the value on the next lines.
const LABELS: { field: Field; pattern: RegExp }[] = [
  { field: "customer", pattern: /^(?:nome(?: do cliente)?|cliente|destinat[aá]rio|para)\s*[:\-–]\s*(.*)$/i },
  { field: "phone", pattern: /^(?:telefone|tel|fone|celular|cel|whats(?:app)?|zap|contato)\s*[:\-–]\s*(.*)$/i },
  { field: "address", pattern: /^(?:endere[cç]o(?: de entrega)?|end|entregar em|local de entrega|entrega)\s*[.:\-–]+\s*(.*)$/i },
  { field: "neighborhood", pattern: /^bairro\s*[:\-–]\s*(.*)$/i },
  { field: "complement", pattern: /^(?:complemento|compl|apto|apartamento)\s*[.:\-–]+\s*(.*)$/i },
  { field: "landmark", pattern: /^(?:(?:ponto de )?refer[eê]ncia|ref)\s*[.:\-–]+\s*(.*)$/i },
  { field: "city", pattern: /^(?:cidade|munic[ií]pio)\s*[.:\-–]+\s*(.*)$/i },
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
  customer: 2, phone: 1, address: 3, neighborhood: 1, complement: 2, landmark: 2, notes: 4, city: 1,
};
/** A line that never continues a field: a separator, money, items, totals, a CEP, a date or a time. */
const ENDS_FIELD = /^[-=_*.·•\s]{3,}$|r\$|^\d+\s*x\b|\b\d+\s*x\s|\b(?:sub)?total\b|pagamento|troco|taxa|\bcep\b|\b\d{5}-\d{3}\b|\d{1,2}\/\d{1,2}\/\d{2,4}|\b\d{1,2}:\d{2}\b/i;
const LETTERS = /^[\p{L}][\p{L}' .-]*$/u;
/** An item's add-on or note, indented under it on a receipt. */
const ITEM_DETAIL = /^\s+[+*]\s/;
/** How the order is delivered, written where an address label could be. */
const NOT_A_PLACE = /^(?:delivery|retirada|balc[aã]o|parceir[oa]|entrega (?:pr[oó]pria|parceira)|pr[oó]pria|motoboy|ifood)\b/i;

const STATES = "AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO";
/**
 * A city with its state closing the text: "Itatiba/SP", "Centro - Itatiba/SP", "Rua X, 12, São Paulo - SP".
 * The city is words joined by a space or a hyphen ("Embu-Guaçu"); before it, " - " or a comma.
 */
const CITY_STATE = new RegExp(
  `^(?:(.*?)\\s*(?:\\s[-–]\\s|,)\\s*)?([\\p{L}][\\p{L}'.]*(?:[ -][\\p{L}][\\p{L}'.]*)*)\\s*(?:\\/|\\s[-–]\\s)\\s*(?:${STATES})\\.?$`, "iu");

/** "Centro - Itatiba/SP" → rest "Centro", city "Itatiba"; null when the text does not end in a city and state. */
export function splitCity(text: string): { rest: string; city: string } | null {
  const match = text.trim().match(CITY_STATE);
  return match ? { rest: (match[1] ?? "").trim(), city: match[2].trim() } : null;
}

/** Whether [line], with no label of its own, carries on the [field] whose value so far is [value]. */
function continues(field: Field, value: string, line: string): boolean {
  if (field === "phone") return !value && findMobile(line) !== null;
  if (ENDS_FIELD.test(line) || findMobile(line)) return false;
  switch (field) {
    // A name wraps into more name: letters only, never a street.
    case "customer": return LETTERS.test(line) && !STREET.test(line) && `${value} ${line}`.trim().split(/\s+/).length <= 6;
    // "Bairro: Centro -" / "Itatiba/SP": the city wrapped onto the next line.
    case "neighborhood": return LETTERS.test(line) || splitCity(line)?.rest === "";
    case "city": return /[-–]$/.test(value) && /^[\p{L}]{2}$/u.test(line);
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

/**
 * A delivery app's 0800 with the order's ID, as it stands for the customer's hidden mobile:
 * "0800 718 2283 ID: 12345678" → "0800 718 2283 · ID 12345678". Null when there is none.
 */
export function findAppContact(text: string): string | null {
  const match = text.match(/\b0800[\s.-]*(\d{3})[\s.-]*(\d{4})\b(?:\D{0,12}?\b(id|c[oó]d(?:igo)?|localizador|ramal)\b\s*[:.]?\s*(\d[\d ]{1,18}\d))?/i);
  if (!match) return null;
  const number = `0800 ${match[1]} ${match[2]}`;
  if (!match[4]) return number;
  const label = match[3].toLowerCase() === "id" ? "ID" : match[3].toLowerCase();
  return `${number} · ${label} ${match[4].replace(/\s+/g, " ")}`;
}

/**
 * Whether the order is picked up at the store ("MODALIDADE: RETIRADA NA LOJA", "Retirar no balcão"):
 * no courier, so it never goes to the panel's delivery queue.
 */
export function isPickup(text: string): boolean {
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /retirada (?:na loja|no balcao|no local|pelo cliente)|retirar (?:na loja|no balcao|no local)|(?:modalidade|tipo(?: de (?:entrega|pedido))?|entrega)\s*:\s*(?:retirada|retirar|balcao|para viagem|take ?away)\b|previsao de retirada/.test(plain);
}

/** "Rua X, 120 - Apto 3" → address "Rua X, 120", complement "Apto 3". */
function splitComplement(address: string): { address: string; complement?: string } {
  const parts = address.split(/\s+[-–]\s+|\s*;\s*/);
  if (parts.length > 1 && COMPLEMENT.test(parts.slice(1).join(" ")))
    return { address: parts[0].trim(), complement: parts.slice(1).join(" - ").trim() };
  return { address: address.trim() };
}

/** Lower case, no accents, single spaces: to compare names typed in different ways. */
export const sameText = (text: string) => ` ${text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim()} `;

const clean = (value: string) => value.replace(/\s+/g, " ").replace(/^[*_~\s]+|[*_~\s]+$/g, "").trim();

export function parsePastedOrder(text: string): { order: PastedOrder; found: (keyof PastedOrder)[] } {
  const order: PastedOrder = {};
  const extra: string[] = [];
  let landmark = "";
  // "   + Ponto da carne" / "   * OBS: tirar o tomate": an item's details, for the kitchen, not the courier.
  const lines = text.split(/\r?\n/).filter(line => !ITEM_DETAIL.test(line)).map(clean).filter(Boolean);
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
    if (field === "phone") {
      const phone = findMobile(value);
      const contact = phone ? null : findAppContact(value);
      if (phone) order.phone = phone; else if (contact && !order.contact) order.contact = contact;
      continue;
    }
    if (field === "notes" && order.notes) { extra.push(value); continue; }
    // "ENTREGA: Delivery (Parceiro iFood)" says how it is delivered, not where.
    if (field === "address" && NOT_A_PLACE.test(value)) continue;
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
    else if (!order.contact) {
      const contact = lines.map(findAppContact).find(Boolean);
      if (contact) order.contact = contact;
    }
  }
  if (!order.reference) {
    const reference = text.match(/#\s?([A-Za-z0-9-]{2,40})\b/);
    if (reference) order.reference = reference[1];
  }
  // A short line of letters only, before anything else, reads as the customer's name.
  if (!order.customer) {
    const name = leftovers.find(line => /^[\p{L}][\p{L}' .-]{1,60}$/u.test(line) && line.split(" ").length <= 5
      && !STREET.test(line) && !COMPLEMENT.test(line) && !/pedido|entrega|total|pagamento|troco|r\$/i.test(line)
      && !splitCity(line));
    if (name) order.customer = name;
  }
  // The city: its own label, the end of the bairro or of the address, or a line of its own ("Itatiba/SP").
  if (order.city) order.city = splitCity(order.city)?.city ?? order.city.replace(/\s*[-–,/]\s*$/, "");
  for (const key of ["neighborhood", "address"] as const) {
    const split = order[key] ? splitCity(order[key]!) : null;
    if (!split) continue;
    order.city ??= split.city;
    if (split.rest) order[key] = split.rest; else delete order[key];
  }
  if (!order.city) {
    const alone = leftovers.map(line => splitCity(line)).find(split => split?.rest === "");
    if (alone) order.city = alone.city;
  }
  if (order.neighborhood) order.neighborhood = order.neighborhood.replace(/\s*[-–,]\s*$/, "") || undefined;
  if (!order.neighborhood) delete order.neighborhood;
  if (order.address) {
    const split = splitComplement(order.address);
    order.address = split.address;
    // "Rua X, 123 - Apto 42" with "Complemento: Bloco B" too: the courier needs both.
    if (split.complement && !sameText(order.complement ?? "").includes(sameText(split.complement)))
      order.complement = order.complement ? `${split.complement} · ${order.complement}` : split.complement;
    // "Rua das Flores, 123, Itatiba": the search looks in the receipt's city, not in the first one it finds.
    if (order.city && !sameText(order.address).includes(sameText(order.city)))
      order.address = `${order.address}, ${order.city}`;
  }
  if (landmark) order.complement = order.complement ? `${order.complement} · ${landmark}` : landmark;
  if (extra.length) order.notes = [order.notes, ...extra].filter(Boolean).join(" · ");

  // Field limits of the form.
  const limits: Record<keyof PastedOrder, number> = {
    customer: 120, phone: 24, address: 200, neighborhood: 120, complement: 240, reference: 40, notes: 500, city: 80, contact: 80,
  };
  for (const key of Object.keys(order) as (keyof PastedOrder)[]) order[key] = order[key]!.slice(0, limits[key]);
  const found = ORDER_FIELDS.filter(key => !!order[key]);
  return { order, found };
}

/** Every field the reader fills, in the order it reports them. */
export const ORDER_FIELDS = ["customer", "phone", "contact", "address", "neighborhood", "city", "complement", "reference", "notes"] as const;

const NAMES: Record<keyof PastedOrder, string> = {
  customer: "nome", phone: "WhatsApp", contact: "contato do app", address: "endereço", neighborhood: "bairro",
  complement: "complemento", reference: "nº do pedido", notes: "observações", city: "cidade",
};
/** "nome, WhatsApp e endereço". */
export function foundText(found: (keyof PastedOrder)[]): string {
  const words = found.map(key => NAMES[key]);
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} e ${words[words.length - 1]}`;
}
