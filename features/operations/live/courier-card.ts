/** The courier card the store opens from the couriers column (get_courier_card). */
export type CourierCard = {
  shiftId: string;
  name: string;
  phone: string | null;
  /** Path inside the private courier-photos bucket; null without a photo. */
  photoPath: string | null;
  motorcycle: { model: string | null; plate: string | null; color: string | null };
  linkStatus: string;
  linkedSince: string | null;
  shiftStatus: string;
  requestedAt: string | null;
  availableSince: string | null;
  locationAt: string | null;
  today: { deliveries: number; totalCents: number };
  deliveriesHere: number;
};

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isTextOrNull = (value: unknown) => value === null || typeof value === "string";

/** Validates get_courier_card(); anything outside the contract is refused instead of guessed. */
export function parseCourierCard(value: unknown): CourierCard {
  const card = value as CourierCard;
  if (!card || typeof card.shiftId !== "string" || typeof card.name !== "string"
    || !isTextOrNull(card.phone) || !isTextOrNull(card.photoPath)
    || !card.motorcycle || !isTextOrNull(card.motorcycle.model) || !isTextOrNull(card.motorcycle.plate)
    || !isTextOrNull(card.motorcycle.color)
    || typeof card.linkStatus !== "string" || !isTextOrNull(card.linkedSince)
    || typeof card.shiftStatus !== "string" || !isTextOrNull(card.requestedAt) || !isTextOrNull(card.availableSince)
    || !isTextOrNull(card.locationAt)
    || !card.today || !isCount(card.today.deliveries) || !isCount(card.today.totalCents)
    || !isCount(card.deliveriesHere)) throw new Error("RPM_CARD_UNEXPECTED");
  return card;
}

/** "+5511987650099" → "(11) 98765-0099"; anything else is shown as stored. */
export function formatPhone(phone: string): string {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone;
}

/** Up to two initials for the photo's place: "Ana Paula Souza" → "AS". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? "" : "";
  return (first + last).toLocaleUpperCase("pt-BR");
}

const LINK: Record<string, string> = {
  ACTIVE: "Ativo", PENDING: "Aguardando aprovação", SUSPENDED: "Suspenso", REJECTED: "Recusado",
};
const SHIFT: Record<string, string> = {
  PENDING: "Turno aguardando aprovação", AVAILABLE: "Disponível na fila", RESERVED: "Reservado para uma rota",
  ON_ROUTE: "Em rota", RETURNING: "Voltando para a loja", ENDED: "Turno encerrado", REJECTED: "Turno recusado",
};
export const linkText = (status: string) => LINK[status] ?? status;
export const shiftText = (status: string) => SHIFT[status] ?? status;

/** "desde 12/11/2026" in the store's time zone. */
export function dayText(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(iso));
}

/** How long ago the courier's GPS last arrived: "agora", "há 4 min", "há 2 h", or the day. */
export function agoText(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 24 * 60) return `há ${Math.floor(minutes / 60)} h`;
  return `em ${dayText(iso)}`;
}
