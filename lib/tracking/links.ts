// Public tracking link and a ready WhatsApp message (wa.me). How customers
// are notified is still open (docs/delivery-core-commands.md); whatever is
// chosen, the courier never gets the customer's phone.

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Same rule as private.normalize_br_phone: +55, DDD, 8 or 9 digits.
const STORED_PHONE = /^\+55[1-9]{2}\d{8,9}$/;

export type TrackingMessageKind = "STARTED" | "NEXT";

export function trackingUrl(origin: string, token: string) {
  if (!TOKEN.test(token)) throw new Error("Link de acompanhamento inválido.");
  return new URL(`/acompanhar/${token.toLowerCase()}`, origin).toString();
}

export function trackingMessage(kind: TrackingMessageKind, restaurantName: string, url: string) {
  const store = restaurantName.trim().replace(/\s+/g, " ");
  if (!store) throw new Error("Informe o nome do estabelecimento.");
  return kind === "STARTED"
    ? `Olá! Seu pedido de ${store} saiu para entrega. Acompanhe por aqui: ${url}`
    : `Olá! Você é a próxima entrega de ${store}. O entregador está indo até você agora. Acompanhe: ${url}`;
}

export function whatsAppLink(phone: string, text: string) {
  if (!STORED_PHONE.test(phone)) throw new Error("Telefone do cliente inválido para WhatsApp.");
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`;
}
