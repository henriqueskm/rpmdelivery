// A printed order (tools/print-capture) as the new-order form starts with it. Pure.

import type { PrintedOrder } from "../../../lib/printing/printer-inbox.ts";
import { formatBrazilianMobilePhone } from "../../../lib/brazilian-mobile-phone.ts";
import { foundText } from "../paste-order.ts";
import { draftText, validPayment } from "../payment.ts";
import type { OrderOrigin } from "../order-origin.ts";
import type { OrderPrefill } from "../dialogs.tsx";

/** An order brought into the new-order form from another system: what it fills and where it came from. */
export type IncomingOrder = { id: string; values: OrderPrefill; filled: string; origin: OrderOrigin };

/** [review]: why the automatic mode left it for the store, said first. */
export function printedToIncoming(item: PrintedOrder, review?: string): IncomingOrder {
  const { order } = item;
  const values: OrderPrefill = { orderedAt: Date.parse(item.receivedAt) };
  for (const key of ["customer", "address", "neighborhood", "complement", "reference", "notes"] as const)
    if (order[key]) values[key] = order[key];
  if (order.phone) values.phone = formatBrazilianMobilePhone(order.phone);
  else if (order.contact) values.contact = order.contact;
  if (order.address) values.searchAddress = true;
  if (item.payment) values.payment = item.payment;
  const hints = [
    order.address ? "Escolha o endereço na lista para confirmar no mapa." : "O cupom não tem endereço: digite o do cliente.",
    ...(order.phone ? [] : order.contact ? ["O app esconde o celular: fica o contato dele, e o WhatsApp é opcional."]
      : ["O cupom não tem celular: peça o WhatsApp do cliente."]),
    validPayment(item.payment) ? `Pagamento: ${draftText(item.payment)}.`
      : item.payment ? `Complete o pagamento (lido: ${draftText(item.payment)}).`
      : "O cupom não diz o pagamento: marque se está pago ou quanto cobrar.",
  ];
  const why = review ? `Não cadastrei sozinho: ${review}. ` : "";
  return { id: item.id, values, filled: `${why}Lido do cupom: ${foundText(item.found)}. ${hints.join(" ")}`,
    origin: { source: "PRINTER", app: item.app, externalId: item.externalId } };
}

/** "Maria Souza · #5127", for the banner. */
export function printedSummary(item: PrintedOrder): string {
  const who = item.order.customer ?? item.order.address ?? "Cliente sem nome no cupom";
  return item.order.reference ? `${who} · #${item.order.reference}` : who;
}
