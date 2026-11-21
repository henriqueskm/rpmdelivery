// What the customer's tracking page shows for each answer of get_tracking.
// Pure: the page component only renders this.

export type TrackingStatus =
  | "PREPARING" | "ON_ROUTE" | "NEXT" | "ATTEMPT_FAILED"
  | "RETURNING_TO_STORE" | "DELIVERED" | "CANCELLED";

export type TrackingPoint = { latitude: number; longitude: number };

/** Before the customer's turn: the ~1 km cell the courier is in, never the point itself. */
export type CourierArea = TrackingPoint & { radiusMeters: number; recordedAt: string };

export type Tracking = {
  status: TrackingStatus;
  restaurantName: string;
  issueReason: string | null;
  stopsBefore: number | null;
  /** Exact position, only when this order is next. */
  courier: (TrackingPoint & { recordedAt: string }) | null;
  courierArea: CourierArea | null;
  /** Courier to this customer's pin: rounded up to 500 m before the turn, to 50 m on it. */
  distanceMeters: number | null;
  destination: TrackingPoint | null;
  startedAt: string | null;
  deliveredAt: string | null;
};

const STATUSES: readonly TrackingStatus[] = [
  "PREPARING", "ON_ROUTE", "NEXT", "ATTEMPT_FAILED", "RETURNING_TO_STORE", "DELIVERED", "CANCELLED",
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function point(value: unknown): TrackingPoint | null {
  const item = record(value);
  if (!item) return null;
  const { latitude, longitude } = item;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function text(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

/** Narrows the RPC answer; anything unexpected becomes null (shown as an error). */
export function parseTracking(value: unknown): Tracking | null {
  const item = record(value);
  if (!item || !STATUSES.includes(item.status as TrackingStatus)) return null;
  const restaurantName = text(item.restaurantName);
  if (!restaurantName) return null;
  const courier = point(item.courier);
  const recordedAt = text(record(item.courier)?.recordedAt);
  const area = point(item.courierArea);
  const areaAt = text(record(item.courierArea)?.recordedAt);
  const radius = record(item.courierArea)?.radiusMeters;
  const stops = item.stopsBefore;
  const distance = item.distanceMeters;
  return {
    status: item.status as TrackingStatus,
    restaurantName,
    issueReason: text(item.issueReason),
    stopsBefore: typeof stops === "number" && Number.isInteger(stops) && stops >= 0 ? stops : null,
    courier: courier && recordedAt ? { ...courier, recordedAt } : null,
    courierArea: area && areaAt && typeof radius === "number" && radius > 0 && radius <= 5_000
      ? { ...area, radiusMeters: radius, recordedAt: areaAt } : null,
    distanceMeters: typeof distance === "number" && Number.isFinite(distance) && distance >= 0 ? Math.round(distance) : null,
    destination: point(item.destination),
    startedAt: text(item.startedAt),
    deliveredAt: text(item.deliveredAt),
  };
}

export type TrackingView = {
  tone: "waiting" | "moving" | "next" | "attention" | "done" | "stopped";
  title: string;
  detail: string;
  /** Index of the current step in TRACKING_STEPS, or null when off the happy path. */
  step: number | null;
  showMap: boolean;
};

export const TRACKING_STEPS = ["Saiu da loja", "Em rota", "Você é o próximo", "Entregue"] as const;

const ISSUE_DETAIL: Record<string, string> = {
  CUSTOMER_NOT_FOUND: "O entregador não encontrou você no endereço.",
  CUSTOMER_NOT_RESPONDING: "O entregador chamou, mas ninguém atendeu.",
  ADDRESS_PROBLEM: "O entregador teve um problema com o endereço.",
  OTHER: "O entregador teve um imprevisto nesta entrega.",
};

/** "a menos de 2 km de você" before the turn (the server already rounded up), "a 650 m de você" on it. */
export function distanceText(meters: number | null, approximate: boolean) {
  if (meters === null) return null;
  const amount = meters >= 1000
    ? `${(meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`
    : `${meters} m`;
  return approximate ? `a menos de ${amount} de você` : `a ${amount} de você`;
}

export function stopsBeforeText(stops: number | null) {
  if (stops === null || stops === 0) return null;
  return stops === 1 ? "1 entrega antes da sua" : `${stops} entregas antes da sua`;
}

export function trackingView(tracking: Tracking): TrackingView {
  const store = tracking.restaurantName;
  switch (tracking.status) {
    case "PREPARING":
      return { tone: "waiting", step: null, showMap: false, title: "Pedido em preparo",
        detail: `O pedido ainda não saiu de ${store}.` };
    case "ON_ROUTE":
      // The map only once there is an area to show: the customer's own pin alone says nothing.
      return { tone: "moving", step: 1, showMap: tracking.courierArea !== null, title: "Seu pedido está a caminho",
        detail: tracking.stopsBefore
          ? "O entregador está fazendo outra entrega antes da sua."
          : "O entregador já está na rua com o seu pedido." };
    case "NEXT":
      return { tone: "next", step: 2, showMap: true, title: "Você é o próximo!",
        detail: "O entregador está indo agora para o seu endereço." };
    case "ATTEMPT_FAILED":
      return { tone: "attention", step: null, showMap: false, title: "Não conseguimos entregar",
        detail: `${ISSUE_DETAIL[tracking.issueReason ?? ""] ?? ISSUE_DETAIL.OTHER} ${store} vai decidir o próximo passo.` };
    case "RETURNING_TO_STORE":
      return { tone: "stopped", step: null, showMap: false, title: "O pedido voltou para a loja",
        detail: `Fale com ${store} para combinar uma nova entrega.` };
    case "DELIVERED":
      return { tone: "done", step: 3, showMap: false, title: "Pedido entregue",
        detail: `Obrigado por pedir em ${store}.` };
    case "CANCELLED":
      return { tone: "stopped", step: null, showMap: false, title: "Entrega cancelada",
        detail: `Fale com ${store} se tiver alguma dúvida.` };
  }
}

/** Seconds until the next refresh, or null when nothing else will change. */
export function refreshSeconds(status: TrackingStatus) {
  if (status === "DELIVERED" || status === "CANCELLED") return null;
  return status === "PREPARING" || status === "RETURNING_TO_STORE" ? 30 : 15;
}

export function clockTime(iso: string | null, timeZone?: string) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone });
}
