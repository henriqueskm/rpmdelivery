// Where an order came from, as the panel shows it next to the order number.
// Orders typed in the panel show nothing; imported ones show the app (or the way they came).

export type OrderOrigin = {
  source: "PRINTER" | "OPEN_DELIVERY";
  /** The app or system as the store knows it ("99Food", "Balcão"). */
  app: string | null;
  /** The order's code in that system. */
  externalId: string;
};

const WAY: Record<OrderOrigin["source"], string> = { PRINTER: "Impressora", OPEN_DELIVERY: "App de delivery" };

/** "99Food", or "Impressora" when the system has no name. */
export function originLabel(origin: OrderOrigin): string {
  return origin.app?.trim() || WAY[origin.source];
}

/** "Veio da impressora (Balcão) · código 5127". */
export function originTitle(origin: OrderOrigin): string {
  const way = origin.source === "PRINTER" ? "Veio da impressora" : "Veio do app de delivery";
  const app = origin.app?.trim();
  return `${way}${app ? ` (${app})` : ""} · código ${origin.externalId}`;
}
