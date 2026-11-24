// How the customer pays, and what the courier collects at the door. Pure: shared by the panel, the
// "Colar pedido" reader and the printer program (Node).

/** PAID: nothing to collect. CASH, CARD, PIX: collected at the door. */
export type PaymentMethod = "PAID" | "CASH" | "CARD" | "PIX";
export const PAYMENT_METHODS: PaymentMethod[] = ["PAID", "CASH", "CARD", "PIX"];

/** A complete payment, as saved (amounts in cents). */
export type OrderPayment = {
  method: PaymentMethod;
  /** What the courier collects; only when not PAID. */
  amountDueCents?: number;
  /** The bill the customer pays with ("troco para R$ 100"); only for cash. */
  changeForCents?: number;
};
/** What a receipt or a pasted text said about it; maybe only part of it. */
export type PaymentDraft = Partial<OrderPayment>;

/** Same limit as the database: R$ 100.000,00. */
export const MAX_CENTS = 10_000_000;

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  PAID: "Já pago", CASH: "Dinheiro", CARD: "Cartão", PIX: "Pix na entrega",
};
/** "no cartão", as in "Cobrar R$ 45,00 no cartão". */
const METHOD_WAY: Record<Exclude<PaymentMethod, "PAID">, string> = { CASH: "em dinheiro", CARD: "no cartão", PIX: "no Pix" };

/** "52,90", "R$ 1.234,50", "100", "52.90" → cents; null when it is not an amount. */
export function parseMoney(text: string): number | null {
  const value = text.replace(/r\$|\s/gi, "");
  // Brazilian ("1.234,50", "52,9", "100") or with a dot for the cents ("52.90").
  const match = value.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/) ?? value.match(/^(\d+)\.(\d{2})$/);
  if (!match) return null;
  const cents = Number(match[1].replace(/\./g, "")) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 5290 → "R$ 52,90"; 123450 → "R$ 1.234,50". */
export function formatMoney(cents: number): string {
  const whole = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${whole},${String(cents % 100).padStart(2, "0")}`;
}

/** The value a money field starts with: 5290 → "52,90". */
export const moneyField = (cents: number | undefined) => cents === undefined ? "" : formatMoney(cents).slice(3);

/** Whether it can be saved as it is (same rules as the database). */
export function validPayment(payment: PaymentDraft | undefined): payment is OrderPayment {
  if (!payment?.method || !PAYMENT_METHODS.includes(payment.method)) return false;
  const { method, amountDueCents: due, changeForCents: change } = payment;
  if (method === "PAID") return due === undefined && change === undefined;
  if (!Number.isInteger(due) || due! < 1 || due! > MAX_CENTS) return false;
  return change === undefined || (method === "CASH" && Number.isInteger(change) && change > due! && change <= MAX_CENTS);
}

/** "Cobrar R$ 52,90 em dinheiro · troco para R$ 100,00"; "Já pago"; "Pagamento não informado". */
export function paymentText(payment: OrderPayment | undefined): string {
  if (!payment) return "Pagamento não informado";
  if (payment.method === "PAID") return "Já pago";
  const due = `Cobrar ${formatMoney(payment.amountDueCents ?? 0)} ${METHOD_WAY[payment.method]}`;
  return payment.changeForCents ? `${due} · troco para ${formatMoney(payment.changeForCents)}` : due;
}

/** A payment read from a receipt, said as the store checks it: complete, or what is missing. */
export function draftText(draft: PaymentDraft | null | undefined): string {
  if (!draft) return "o cupom não diz";
  if (validPayment(draft)) return paymentText(draft);
  const how = draft.method ? METHOD_LABEL[draft.method] : "forma não reconhecida";
  const due = draft.amountDueCents ? formatMoney(draft.amountDueCents) : "valor não reconhecido";
  return `${how} · ${due}`;
}

/** The arguments create_order, import_order and update_order take. */
export function paymentArgs(payment: OrderPayment | undefined) {
  return {
    p_payment_method: payment?.method ?? null,
    p_amount_due_cents: payment && payment.method !== "PAID" ? payment.amountDueCents ?? null : null,
    p_change_for_cents: payment?.method === "CASH" ? payment.changeForCents ?? null : null,
  };
}

/** A payment read from JSON (the board, the printer program); anything malformed is left out. */
export function readPaymentJson(value: unknown): PaymentDraft | undefined {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return undefined;
  const draft: PaymentDraft = {};
  if (PAYMENT_METHODS.includes(raw.method as PaymentMethod)) draft.method = raw.method as PaymentMethod;
  const cents = (key: string) => Number.isInteger(raw[key]) && (raw[key] as number) > 0 && (raw[key] as number) <= MAX_CENTS
    ? raw[key] as number : undefined;
  if (cents("amountDueCents") !== undefined) draft.amountDueCents = cents("amountDueCents");
  if (cents("changeForCents") !== undefined) draft.changeForCents = cents("changeForCents");
  return Object.keys(draft).length ? draft : undefined;
}

// ------------------------------------------------------------------ reading a receipt or a message

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Every amount on a line: "R$ 52,90", "52,90", "troco pra 100" (whole reais after "troco"). */
function amounts(line: string): number[] {
  const found: number[] = [];
  for (const match of line.matchAll(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})\b|r\$\s*(\d+)\b/gi)) {
    const cents = parseMoney(match[1] ?? match[2]);
    if (cents) found.push(cents);
  }
  return found;
}

// "Valor pago: R$ 100,00" on a cash receipt is the bill the customer hands over, not "already paid".
const PAID = /\bonline\b|ja (?:esta )?pago|nao cobrar|pedido pago|pago (?:pelo|no|na|via|com|antecipad)|pagamento (?:realizado|efetuado|aprovado|confirmado)|:\s*pago$/;
const NOT_PAID = /cobrar|na entrega|receber|a pagar|valor pago|total pago|troco/;
const CASH = /dinheiro|especie/;
const CARD = /cart[ao]|credito|debito|maquin|vale[ -]?(?:refeicao|alimentacao)|\bvr\b|ticket|alelo|sodexo|\bvisa\b|master|\belo\b/;
const PIX = /\bpix\b/;
const PAYMENT_LINE = /pagamento|\bpago\b|cobrar|forma|dinheiro|especie|cartao|credito|debito|maquin|\bpix\b|troco|online|receber/;

/** "[ ]", "( )": an option the receipt left unticked. "[X]", "(x)", "[✓]": the one that holds. */
const UNTICKED = /^\s*[[(]\s?[\])]/;
const TICKED = /^\s*[[(]\s?[x✓✔*]\s?[\])]/i;

/**
 * Some receipts print every payment option with a box and tick one ("[X] PAGO ONLINE" /
 * "[ ] COBRAR NA ENTREGA: Dinheiro" with its indented "Troco para" below). An unticked option, with
 * the indented lines under it, says nothing about this order and is left out.
 */
function optionsTicked(lines: string[]): string[] {
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (UNTICKED.test(line) && !TICKED.test(line)) { skipping = true; continue; }
    // The option's own lines are indented under it; the next line at the margin ends it.
    if (skipping && /^\s+\S/.test(line)) continue;
    skipping = false;
    kept.push(line);
  }
  return kept;
}

/**
 * What a receipt or a message says about the payment, or null when it says nothing. It reads the
 * payment lines and the total; the store still confirms it in the form, and the automatic mode only
 * saves it alone when it is complete.
 */
export function readPayment(text: string): PaymentDraft | null {
  const lines = optionsTicked(text.split(/\r?\n/)).map(line => plain(line).replace(/\s+/g, " ").trim()).filter(Boolean);
  let method: PaymentMethod | undefined;
  let total: number | undefined;
  let due: number | undefined;
  let change: number | undefined;
  let noChange = false;
  let paid = false;
  for (const line of lines) {
    // The last total wins: "TOTAL R$ 79,00" comes after the items and the delivery fee.
    if (/^(?:valor )?total\b(?! de itens| dos itens)/.test(line) && amounts(line).length) total = amounts(line).at(-1);
    if (/cobrar|a receber|valor a pagar/.test(line) && amounts(line).length) due = amounts(line).at(-1);
    // "Valor pago: R$ 100,00" / "paga com 100" on a cash order: the bill the customer hands over.
    if (/valor pago|paga com|pagar com/.test(line) && amounts(line).length) change ??= amounts(line).at(-1);
    if (/troco/.test(line)) {
      if (/sem troco|nao precisa(?: de)? troco|troco:? ?(?:nao|-)$/.test(line)) noChange = true;
      else {
        const value = amounts(line).at(-1) ?? Number(line.match(/troco\s*(?:para|pra|p\/)?\s*:?\s*(\d{1,6})\b/)?.[1]) * 100;
        if (value) change ??= /troco\s*(?:para|pra|p\/)/.test(line) ? value : -value;
      }
    }
    if (!PAYMENT_LINE.test(line)) continue;
    if (PAID.test(line) && !NOT_PAID.test(line)) paid = true;
    method ??= CASH.test(line) ? "CASH" : CARD.test(line) ? "CARD" : PIX.test(line) ? "PIX" : undefined;
  }
  if (paid) return { method: "PAID" };
  if (!method && change !== undefined) method = "CASH";
  if (!method && due === undefined) return null;
  const draft: PaymentDraft = {};
  if (method) draft.method = method;
  const amount = due ?? total;
  if (amount) draft.amountDueCents = amount;
  // "Troco: R$ 47,10" is the change itself; "troco para 100" is the bill.
  if (change !== undefined && !noChange && (draft.method ?? "CASH") === "CASH") {
    const bill = change > 0 ? change : amount ? amount - change : undefined;
    if (bill && (!amount || bill > amount) && bill <= MAX_CENTS) draft.changeForCents = bill;
  }
  return draft;
}
