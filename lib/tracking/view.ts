// What the customer's tracking page shows for each answer of get_tracking.
// Pure: the page component only renders this.

export type TrackingStatus =
  | "PREPARING" | "ON_ROUTE" | "NEXT" | "ATTEMPT_FAILED"
  | "RETURNING_TO_STORE" | "DELIVERED" | "CANCELLED";

export type TrackingPoint = { latitude: number; longitude: number };

export type Tracking = {
  status: TrackingStatus;
  restaurantName: string;
  issueReason: string | null;
  stopsBefore: number | null;
  courier: (TrackingPoint & { recordedAt: string }) | null;
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
  const stops = item.stopsBefore;
  return {
    status: item.status as TrackingStatus,
    restaurantName,
    issueReason: text(item.issueReason),
    stopsBefore: typeof stops === "number" && Number.isInteger(stops) && stops >= 0 ? stops : null,
    courier: courier && recordedAt ? { ...courier, recordedAt } : null,
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
      return { tone: "moving", step: 1, showMap: false, title: "Seu pedido está a caminho",
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

const coordinate = (value: number) => value.toFixed(5);

/** Mapbox static image with the courier and the customer's own address. */
export function trackingMapUrl(token: string | undefined, courier: TrackingPoint | null, destination: TrackingPoint | null) {
  // Only a separate, public Maps token can be embedded in an image URL.
  if (!token?.startsWith("pk.") || (!courier && !destination)) return null;
  const pins = [
    destination && `pin-l-home+bd401b(${coordinate(destination.longitude)},${coordinate(destination.latitude)})`,
    courier && `pin-l-scooter+1d2c24(${coordinate(courier.longitude)},${coordinate(courier.latitude)})`,
  ].filter(Boolean).join(",");
  const only = courier && destination ? null : courier ?? destination;
  const view = only ? `${coordinate(only.longitude)},${coordinate(only.latitude)},15` : "auto";
  const padding = only ? "" : "&padding=60";
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pins}/${view}/640x320@2x?access_token=${encodeURIComponent(token)}${padding}`;
}
