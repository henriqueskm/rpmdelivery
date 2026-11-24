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
  // "Telefone (Ramal): (11) 4003-9900" on 99Food's receipt.
  { field: "phone", pattern: /^(?:telefone|tel|fone|celular|cel|whats(?:app)?|zap|contato)(?:\s*\([^)]{1,20}\))?\s*[:\-–]\s*(.*)$/i },
  { field: "address", pattern: /^(?:endere[cç]o(?: de entrega)?|end|entregar em|local de entrega|entrega)\s*[.:\-–]+\s*(.*)$/i },
  { field: "neighborhood", pattern: /^bairro\s*[:\-–]\s*(.*)$/i },
  { field: "complement", pattern: /^(?:complemento|compl|apto|apartamento)\s*[.:\-–]+\s*(.*)$/i },
  { field: "landmark", pattern: /^(?:(?:ponto de )?refer[eê]ncia|ref)\s*[.:\-–]+\s*(.*)$/i },
  { field: "city", pattern: /^(?:cidade|munic[ií]pio)\s*[.:\-–]+\s*(.*)$/i },
  { field: "notes", pattern: /^(?:observa[cç](?:[oõ]es|[aã]o)|obs)\s*[.:\-–]+\s*(.*)$/i },
  { field: "reference", pattern: /^(?:pedido|n[ºo°]\.? do pedido|n[uú]mero do pedido|c[oó]digo(?!\s+de\b))\s*[:\-–#nº°]*\s*#?\s*([A-Za-z0-9-]{1,40})\b/i },
];

/** "Via" is a street ("Via Anhanguera") but also a receipt's copy: "VIA COZINHA", "Via do entregador". */
const COPY_NAME = String.raw`\s+(?:(?:d[aoe]s?|para)\s+)?(?:cozinha|produ[cç][aã]o|preparo|cliente|entregador|entrega|motoboy|loja|estabelecimento|caixa|balc[aã]o|delivery|expedi[cç][aã]o)\b`;
const STREET = new RegExp(String.raw`^(?:rua|r\.|av\.?|avenida|alameda|al\.|travessa|tv\.|estrada|est\.|rodovia|rod\.|pra[cç]a|p[cç]a\.?|largo|via(?!${COPY_NAME})|viela)\s+\S`, "i");
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
/**
 * An item's add-on, flavor or note, indented under it on a receipt: "   + Borda: Catupiry",
 * "   - 1/2 Calabresa", "       Obs.: Sem picles" (Cardápio Web, Anota AI). The order's own note is at the margin.
 */
const ITEM_DETAIL = /^\s+(?:[+*-]\s|obs\b)/i;
const ITEM_ADDON = /^\s+[+*]\s/;
/** An item of the order: "1x X-Bacon", "#1  2x X-Bacon", "2 x Coca". */
const ITEM_LINE = /^\s*(?:#\d+\s+)?\d+\s*x\s/i;
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
  // "Telefone (Ramal): (11)" / "4003-9900": the number wrapped after its area code.
  if (field === "phone") return !/\d{4}/.test(value) && /^\(?\d/.test(line) && /\d{4}/.test(line) && !ENDS_FIELD.test(line);
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

/** The code the customer's call is routed with, most specific first: "Código de Acesso: 83920145". */
const APP_CODES: { label: string; pattern: RegExp }[] = [
  // "Código 9921" or "Código de Acesso: 9921", never "Código de Entrega" nor "Código de Coleta".
  { label: "código", pattern: /\bc[oó]d(?:igo)?\.?(?:\s+de\s+acesso)?\s*[:.]?\s*(\d[\d ]{1,18}\d)/i },
  { label: "ramal", pattern: /\bramal\b\s*[:.]?\s*(\d[\d ]{1,18}\d)/i },
  { label: "ID", pattern: /\bid\b\s*[:.]?\s*(\d[\d ]{1,18}\d)/i },
  { label: "localizador", pattern: /\blocalizador\b\s*[:.]?\s*(\d[\d ]{1,18}\d)/i },
];

/**
 * A delivery app's number with the order's code, as it stands for the customer's hidden mobile:
 * "0800 718 2283 ID: 12345678" → "0800 718 2283 · ID 12345678"; 99Food's "(11) 4003-9900" with
 * "Código de Acesso: 83920145" → "(11) 4003-9900 · código 83920145". The number is a 0800/0300, a
 * capital number (4003, 3003…: under the phone label or with a code), or a landline (only under the
 * phone label, [landline], and with a code: a store's own number is not the customer). The code is
 * looked for in [codes] (the whole receipt: it may be on a line of its own). Null when there is none.
 */
export function findAppContact(text: string, codes = text, landline = false): string | null {
  const code = APP_CODES.map(({ label, pattern }) => {
    const match = codes.match(pattern);
    return match ? `${label} ${match[1].replace(/\s+/g, " ")}` : null;
  }).find(Boolean);
  const free = text.match(/\b(0[38]00)[\s.-]*(\d{3})[\s.-]*(\d{4})\b/);
  const capital = !landline && !code ? null : text.match(/(?:\(\s*([1-9]{2})\s*\)\s*|\b([1-9]{2})[\s.-]+)?\b(300\d|400\d|40[2-9]\d)[\s.-]?(\d{4})\b/);
  const fixed = landline && code ? text.match(/\(\s*([1-9]{2})\s*\)\s*([2-5]\d{3})[\s.-]?(\d{4})\b/) : null;
  const ddd = (value?: string) => value ? `(${value}) ` : "";
  const number = free ? `${free[1]} ${free[2]} ${free[3]}`
    : capital ? `${ddd(capital[1] ?? capital[2])}${capital[3]}-${capital[4]}`
    : fixed ? `(${fixed[1]}) ${fixed[2]}-${fixed[3]}` : null;
  if (!number) return null;
  return code ? `${number} · ${code}` : number;
}

/**
 * Whether the order is picked up at the store ("MODALIDADE: RETIRADA NA LOJA", "Retirar no balcão"):
 * no courier, so it never goes to the panel's delivery queue.
 */
export function isPickup(text: string): boolean {
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // "PEDIDO #0148 [ RETIRADA ]" / "[ CONSUMO NO LOCAL ]": Cardápio Web and Anota AI tag the type in brackets.
  return /retirada (?:na loja|no balcao|no local|pelo cliente)|retirar (?:na loja|no balcao|no local)|(?:modalidade|tipo(?: de (?:entrega|pedido))?|entrega)\s*:\s*(?:retirada|retirar|balcao|para viagem|take ?away)\b|previsao de retirada|consumo no local|\[\s*(?:retirada|retirar|balcao|no local|mesa|comanda)\b/.test(plain);
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
  // "+ " and "* " always are; "- " and "Obs." only once the items began ("1x …", "#1  2x …"), as an
  // address may wrap into an indented "- Apto 32".
  let items = false;
  const lines = text.split(/\r?\n/).filter(line => {
    items ||= ITEM_LINE.test(line);
    return !(items ? ITEM_DETAIL : ITEM_ADDON).test(line);
  }).map(clean).filter(Boolean);
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
      // A landline under the phone label counts only with the app's code, printed anywhere on the receipt.
      const contact = phone ? null : findAppContact(value, text, true);
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
    // The store's own WhatsApp heads some receipts ("Tel/WhatsApp: (11) 99999-0000", Anota AI): a mobile
    // is only looked for from the order's or the customer's first line on, when the receipt has one.
    const start = lines.findIndex(line => /^(?:pedido\b|(?:dados do )?cliente\b)/i.test(line));
    const phone = findMobile(start > 0 ? lines.slice(start).join("\n") : text);
    if (phone) order.phone = phone;
    else if (!order.contact) {
      const contact = lines.map(line => findAppContact(line, text)).find(Boolean);
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
