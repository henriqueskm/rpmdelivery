/** Courier pay as the store sees it: rates and what each courier earned on a day. */
export type CourierPay = {
  day: string;
  shiftFeeCents: number;
  deliveryFeeCents: number;
  canEdit: boolean;
  couriers: { name: string; deliveries: number; shiftFeeCents: number; deliveryFeesCents: number; totalCents: number }[];
};

const MAX_CENTS = 100_000;

const isCents = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** Validates get_courier_pay(); anything outside the contract is refused instead of guessed. */
export function parseCourierPay(value: unknown): CourierPay {
  const pay = value as CourierPay;
  if (!pay || typeof pay.day !== "string" || !isCents(pay.shiftFeeCents) || !isCents(pay.deliveryFeeCents)
    || typeof pay.canEdit !== "boolean" || !Array.isArray(pay.couriers)) throw new Error("RPM_PAY_UNEXPECTED");
  for (const courier of pay.couriers) {
    if (typeof courier?.name !== "string" || !isCents(courier.deliveries) || !isCents(courier.shiftFeeCents)
      || !isCents(courier.deliveryFeesCents) || !isCents(courier.totalCents)) throw new Error("RPM_PAY_UNEXPECTED");
  }
  return pay;
}

/** 3700 → "R$ 37,00". */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100).replace(/ /g, " ");
}

/** "37", "37,5", "37,50", "R$ 1.000,00" → cents; null when it is not a value from R$ 0 to R$ 1.000. */
export function parseReais(text: string): number | null {
  const clean = text.replace(/R\$/i, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.replace(/\./g, "").split(",");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

/** Cents as the store types them back: 3000 → "30,00". */
export function centsInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
