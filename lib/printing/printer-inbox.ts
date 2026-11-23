// Printed orders handed from the virtual printer (tools/print-capture) to the panel open on the same
// computer. The program keeps them in memory and serves them on 127.0.0.1 only; the panel asks for
// them, the store checks the address on the map and saves through import_order (source PRINTER).
// Pure: shared by the program (Node) and the panel (browser).

import type { PastedOrder } from "../../features/operations/paste-order.ts";

export const PRINTER_INBOX_PORT = 9180;
export const PRINTER_INBOX_URL = `http://127.0.0.1:${PRINTER_INBOX_PORT}`;
/** Sent on every request of the panel. A custom header makes browsers ask first (CORS preflight). */
export const PANEL_HEADER = "x-rpm-painel";
/** The pages allowed to read printed orders, besides those given with --origem. */
export const PANEL_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "https://rpmdelivery.vercel.app"];

export type PrintedOrder = {
  id: string;
  receivedAt: string;
  /** The order's code in the store's system: number and day, or the receipt's fingerprint. */
  externalId: string;
  /** The store's name for the printing system ("Balcão"), from --sistema. */
  app: string | null;
  order: PastedOrder;
  found: (keyof PastedOrder)[];
};

const two = (value: number) => String(value).padStart(2, "0");

/**
 * The code that identifies a printed order. Store systems often restart their numbering every day,
 * so the number goes with the day ("5127 · 22/11/2026"): a reprint the same day is the same order,
 * tomorrow's #5127 is another. Without a number, the receipt's fingerprint: an identical reprint
 * is the same order.
 */
export function printedExternalId(reference: string | undefined, receivedAt: Date, fingerprint: string): string {
  if (reference) return `${reference} · ${two(receivedAt.getDate())}/${two(receivedAt.getMonth() + 1)}/${receivedAt.getFullYear()}`;
  return `cupom ${fingerprint.slice(0, 12)}`;
}

/** Whether a printed receipt is worth offering to the panel: at least a name, a WhatsApp or an address. */
export function isOrderLike(found: (keyof PastedOrder)[]): boolean {
  return found.some(key => key === "customer" || key === "phone" || key === "address");
}

const FIELDS = ["customer", "phone", "address", "neighborhood", "complement", "reference", "notes"] as const;

/** The panel's reading of the program's answer; anything malformed is left out. */
export function parsePrintedOrders(value: unknown): PrintedOrder[] {
  const list = (value as { orders?: unknown } | null)?.orders;
  if (!Array.isArray(list)) return [];
  const orders: PrintedOrder[] = [];
  for (const item of list.slice(0, 50)) {
    const candidate = item as Partial<PrintedOrder> | null;
    if (!candidate || typeof candidate.id !== "string" || !/^[\w-]{1,64}$/.test(candidate.id)) continue;
    if (typeof candidate.externalId !== "string" || !candidate.externalId.trim() || candidate.externalId.length > 80) continue;
    if (typeof candidate.receivedAt !== "string" || Number.isNaN(Date.parse(candidate.receivedAt))) continue;
    const raw = (candidate.order ?? {}) as Record<string, unknown>;
    const order: PastedOrder = {};
    for (const key of FIELDS) {
      const text = raw[key];
      if (typeof text === "string" && text.trim()) order[key] = text.trim().slice(0, 500);
    }
    const found = FIELDS.filter(key => !!order[key]);
    if (!isOrderLike(found)) continue;
    const app = typeof candidate.app === "string" && candidate.app.trim() ? candidate.app.trim().slice(0, 40) : null;
    orders.push({ id: candidate.id, receivedAt: candidate.receivedAt, externalId: candidate.externalId.trim(), app, order, found });
  }
  return orders;
}

/**
 * Whether the program answers a request: only on its own address (a web page renamed to 127.0.0.1,
 * "DNS rebinding", is refused), only with the panel's header, and only to the panel's pages.
 */
export function allowedRequest(request: { host?: string; origin?: string; panel?: string }, port: number, origins: string[]) {
  const hostOk = request.host === `127.0.0.1:${port}` || request.host === `localhost:${port}`;
  const originOk = request.origin === undefined || origins.includes(request.origin);
  return hostOk && originOk && request.panel === "1";
}
