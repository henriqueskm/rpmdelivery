// Automatic mode for printed orders: when everything on the receipt checks out, the order goes straight
// to "Aguardando despacho"; otherwise it waits for the store with the reason. Pure: the search and the
// save are done by the caller (use-auto-printed).
//
// Conservative on purpose: a wrong address sends a courier to the wrong house, so the order is saved
// alone only when the map finds the same street and house number the receipt has, near the store.

import type { PrintedOrder } from "../../../lib/printing/printer-inbox.ts";
import type { AddressSuggestion, GeoPoint, ResolvedAddress } from "../../../services/geocoding/types.ts";
import { formatBrazilianMobilePhone, isValidBrazilianMobilePhone } from "../../../lib/brazilian-mobile-phone.ts";
import type { NewOrder } from "../model.ts";
import { sameText } from "../paste-order.ts";

/** Farther than this from the store, the address found is probably another city's street of the same name. */
export const AUTO_MAX_KM = 30;

const STREET_TYPES = new Set(["rua", "r", "av", "avenida", "al", "alameda", "travessa", "tv", "trav", "estrada", "est",
  "rodovia", "rod", "praca", "pca", "largo", "lgo", "via", "viela", "beco", "servidao"]);
const LINKS = new Set(["da", "das", "de", "do", "dos", "e"]);

const words = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

/**
 * The house number: the one after the comma ("Rua 25 de Março, 100"), or one closing the text
 * ("Rua das Flores 100"). "Rua 25 de Março" has none: the 25 is part of the name.
 */
export function houseNumber(address: string): string | null {
  const afterComma = address.match(/,\s*(?:n[º°o.]*\s*)?(\d{1,6})\b/i);
  if (afterComma) return afterComma[1];
  // "Rua das Flores 100, Itatiba": the number closes the street part.
  return address.split(",")[0].match(/\S\s+(?:n[º°o.]*\s*)?(\d{1,6})\s*$/i)?.[1] ?? null;
}

/** Whether the map's suggestion lies in [city] ("Brotas, Atibaia - São Paulo" is not Itatiba). */
export function inCity(suggestion: AddressSuggestion, city: string): boolean {
  // The map writes "bairro, cidade - estado, CEP, país": the city is what comes before " - ".
  // Without that shape, the city's name anywhere in it (but never in the street) will do.
  const mapCity = suggestion.secondaryLabel.split(",").map(part => part.match(/^\s*(.+?)\s+[-–]\s+\S/)?.[1]).find(Boolean);
  return mapCity ? sameText(mapCity) === sameText(city) : sameText(suggestion.secondaryLabel).includes(sameText(city));
}

/** The words that name the street ("Rua das Flores, 100" → flores), without its type and links. */
export function streetWords(address: string): string[] {
  const number = houseNumber(address);
  const street = address.split(",")[0];
  return words(street).filter(word => !STREET_TYPES.has(word) && !LINKS.has(word) && word !== number);
}

const sameWord = (a: string, b: string) => a === b || (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b));

/**
 * The suggestion with the receipt's street and house number, or null when none is sure. When the
 * receipt names its [city], only a suggestion in that city counts: the same street name is common.
 */
export function matchSuggestion(address: string, suggestions: AddressSuggestion[], city?: string): AddressSuggestion | null {
  const number = houseNumber(address);
  const street = streetWords(address);
  if (!number || !street.length) return null;
  return suggestions.find(suggestion => {
    if (suggestion.kind === "street") return false;
    if (city && !inCity(suggestion, city)) return false;
    if (houseNumber(suggestion.label) !== number) return false;
    const label = streetWords(suggestion.label);
    // Both ways: "Rua das Flores" is not "Rua das Flores Novas".
    return street.every(word => label.some(other => sameWord(word, other)))
      && label.every(word => street.some(other => sameWord(word, other)));
  }) ?? null;
}

/** Why the receipt cannot be saved alone before searching the map, or null when it can be tried. */
export function receiptBlock(item: PrintedOrder): string | null {
  const { order } = item;
  if (!order.customer) return "o cupom não tem o nome do cliente";
  if (!order.phone || !isValidBrazilianMobilePhone(order.phone)) return "o cupom não tem um celular do cliente";
  if (!order.address) return "o cupom não tem endereço";
  if (!houseNumber(order.address)) return "o endereço do cupom não tem número";
  return null;
}

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The order to save alone, or why the store must check it. */
export function autoOrder(item: PrintedOrder, found: ResolvedAddress, defaultPromiseMinutes: number, store?: GeoPoint):
  { order: NewOrder } | { reason: string } {
  const neighborhood = item.order.neighborhood?.trim() || found.neighborhood?.trim();
  if (!neighborhood) return { reason: "não achei o bairro" };
  if (store) {
    const km = distanceKm(store, found);
    if (km > AUTO_MAX_KM) return { reason: `o endereço encontrado fica a ${Math.round(km)} km da loja` };
  }
  return { order: {
    reference: item.order.reference ?? "",
    customer: item.order.customer ?? "",
    phone: formatBrazilianMobilePhone(item.order.phone ?? ""),
    address: found.address,
    neighborhood,
    complement: item.order.complement ?? "",
    notes: item.order.notes ?? "",
    orderedAt: Date.parse(item.receivedAt),
    promisedMinutes: defaultPromiseMinutes,
    geocode: { latitude: found.latitude, longitude: found.longitude, providerId: found.providerId },
    origin: { source: "PRINTER", app: item.app, externalId: item.externalId },
  } };
}
