// The virtual printer's queue of printed orders, kept safe at peak hours. Pure: the program
// (tools/print-capture) keeps the state, saves it to a file after each change and reads it back on start.
//
// - A reprint is the same order only when the number, the day and the customer agree: the 7 from iFood
//   and the 7 from the store's site, both printed today, are two orders ("7 · 23/11/2026" and "… · 2").
// - Nothing is dropped quietly: the queue holds QUEUE_LIMIT orders and says when it is getting full.

import { ORDER_FIELDS, sameText, type PastedOrder } from "../../features/operations/paste-order.ts";
import type { PaymentDraft } from "../../features/operations/payment.ts";
import { parsePrintedOrders, printedExternalId, QUEUE_LIMIT, type PrintedOrder } from "./printer-inbox.ts";

/** An order code given out, with who it was for: a later receipt with the same number is compared to it. */
export type SeenOrder = { externalId: string; base: string; phone?: string; customer?: string; at: string };
export type QueueState = { inbox: PrintedOrder[]; seen: SeenOrder[] };

/** Codes are remembered this long: numbering restarts every day, and a reprint comes the same day. */
const SEEN_MS = 2 * 24 * 3600_000;
/** On start, orders older than this are not offered again: the store has dealt with them on paper. */
export const RESTORE_MS = 24 * 3600_000;
/** From this many waiting orders on, the program warns that the panel is not taking them. */
export const QUEUE_WARNING = 400;

export const emptyQueue = (): QueueState => ({ inbox: [], seen: [] });

const nameWords = (name: string) => sameText(name).trim().split(" ").filter(Boolean);

/**
 * Whether two receipts with the same number are the same order. Different mobiles, or names that do
 * not fit ("Lucas" fits "Lucas Mendes", a wrapped line can be missing), make two orders. Without
 * anything to compare, it is a reprint.
 */
export function sameCustomer(a: Pick<PastedOrder, "phone" | "customer">, b: Pick<PastedOrder, "phone" | "customer">): boolean {
  if (a.phone && b.phone) return a.phone === b.phone;
  if (a.customer && b.customer) {
    const [short, long] = [nameWords(a.customer), nameWords(b.customer)].sort((x, y) => x.length - y.length);
    return short.every((word, at) => long[at] === word);
  }
  return true;
}

export type Placed = {
  externalId: string;
  /** A reprint of an order already given a code (the copy still waiting, if any, is replaced). */
  reprint: boolean;
  /** Waiting orders dropped because the queue was full (oldest first): only past QUEUE_LIMIT. */
  dropped: PrintedOrder[];
};

/** Adds a printed order to [state] (changed in place) and says which code it got. */
export function placeReceipt(state: QueueState, receipt: { id: string; receivedAt: Date; fingerprint: string; app: string | null;
  order: PastedOrder; found: (keyof PastedOrder)[]; payment?: PaymentDraft | null }): Placed {
  const base = printedExternalId(receipt.order.reference, receipt.receivedAt, receipt.fingerprint);
  const known = state.seen.filter(item => item.base === base);
  const same = known.find(item => sameCustomer(item, receipt.order));
  const externalId = same?.externalId ?? (known.length ? `${base} · ${known.length + 1}` : base);
  if (same) {
    if (!same.phone && receipt.order.phone) same.phone = receipt.order.phone;
    if (!same.customer && receipt.order.customer) same.customer = receipt.order.customer;
  } else {
    state.seen.push({ externalId, base, at: receipt.receivedAt.toISOString(),
      ...(receipt.order.phone ? { phone: receipt.order.phone } : {}),
      ...(receipt.order.customer ? { customer: receipt.order.customer } : {}) });
  }
  // A reprint replaces the copy still waiting: one card per order on the panel. What the new copy
  // lacks comes from the waiting one: a kitchen copy printed after the courier's has no address,
  // phone nor payment, and must not wipe them.
  const at = state.inbox.findIndex(item => item.externalId === externalId);
  const waiting = at >= 0 ? state.inbox.splice(at, 1)[0] : null;
  const order: PastedOrder = { ...waiting?.order, ...receipt.order };
  const found = ORDER_FIELDS.filter(key => !!order[key]);
  const payment = receipt.payment ?? waiting?.payment;
  state.inbox.push({ id: receipt.id, receivedAt: receipt.receivedAt.toISOString(), externalId, app: receipt.app,
    order, found, ...(payment ? { payment } : {}) });
  const dropped = state.inbox.length > QUEUE_LIMIT ? state.inbox.splice(0, state.inbox.length - QUEUE_LIMIT) : [];
  return { externalId, reprint: !!same, dropped };
}

/** The panel saved or discarded it: out of the queue. The code stays known, for reprints. */
export function takeOrder(state: QueueState, id: string): PrintedOrder | null {
  const at = state.inbox.findIndex(item => item.id === id);
  return at >= 0 ? state.inbox.splice(at, 1)[0] : null;
}

/** The queue saved in the file, checked; what is too old or malformed is left out. */
export function restoreQueue(saved: unknown, now: Date): QueueState {
  const raw = (saved ?? {}) as { inbox?: unknown; seen?: unknown };
  const fresh = (at: string, limit: number) => now.getTime() - Date.parse(at) <= limit;
  const inbox = parsePrintedOrders({ orders: raw.inbox }).filter(item => fresh(item.receivedAt, RESTORE_MS));
  const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;
  const seen = (Array.isArray(raw.seen) ? raw.seen : []).flatMap((item): SeenOrder[] => {
    const entry = item as Partial<SeenOrder> | null;
    if (!entry || !text(entry.externalId, 80) || !text(entry.base, 80) || !text(entry.at, 40)
      || Number.isNaN(Date.parse(entry.at!)) || !fresh(entry.at!, SEEN_MS)) return [];
    return [{ externalId: entry.externalId!, base: entry.base!, at: entry.at!,
      ...(text(entry.phone, 24) ? { phone: entry.phone } : {}), ...(text(entry.customer, 120) ? { customer: entry.customer } : {}) }];
  });
  return { inbox, seen };
}

/** What goes to the file: codes older than two days are forgotten. */
export function queueToSave(state: QueueState, now: Date): QueueState {
  return { inbox: state.inbox, seen: state.seen.filter(item => now.getTime() - Date.parse(item.at) <= SEEN_MS) };
}
