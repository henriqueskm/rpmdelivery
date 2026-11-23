// A printed order (tools/print-capture) as the new-order form starts with it. Pure.

import type { PrintedOrder } from "../../../lib/printing/printer-inbox.ts";
import { formatBrazilianMobilePhone } from "../../../lib/brazilian-mobile-phone.ts";
import { foundText } from "../paste-order.ts";
import type { OrderOrigin } from "../order-origin.ts";
import type { OrderPrefill } from "../dialogs.tsx";

/** An order brought into the new-order form from another system: what it fills and where it came from. */
export type IncomingOrder = { id: string; values: OrderPrefill; filled: string; origin: OrderOrigin };

export function printedToIncoming(item: PrintedOrder): IncomingOrder {
  const { order } = item;
  const values: OrderPrefill = { orderedAt: Date.parse(item.receivedAt) };
  for (const key of ["customer", "address", "neighborhood", "complement", "reference", "notes"] as const)
    if (order[key]) values[key] = order[key];
  if (order.phone) values.phone = formatBrazilianMobilePhone(order.phone);
  if (order.address) values.searchAddress = true;
  const hints = [
    order.address ? "Escolha o endereço na lista para confirmar no mapa." : "O cupom não tem endereço: digite o do cliente.",
    ...(order.phone ? [] : ["O cupom não tem celular: peça o WhatsApp do cliente."]),
  ];
  return { id: item.id, values, filled: `Lido do cupom: ${foundText(item.found)}. ${hints.join(" ")}`,
    origin: { source: "PRINTER", app: item.app, externalId: item.externalId } };
}

/** "Maria Souza · #5127", for the banner. */
export function printedSummary(item: PrintedOrder): string {
  const who = item.order.customer ?? item.order.address ?? "Cliente sem nome no cupom";
  return item.order.reference ? `${who} · #${item.order.reference}` : who;
}
