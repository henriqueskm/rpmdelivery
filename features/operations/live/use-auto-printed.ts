"use client";
// Automatic mode: each printed order is tried once, one at a time. Saved alone when the receipt and
// the map agree (auto-printed.ts); otherwise it waits on the banner with the reason.

import { useEffect, useRef, useState } from "react";
import type { PrintedOrder } from "@/lib/printing/printer-inbox";
import { resolveAddress, suggestAddress } from "@/services/geocoding/client";
import type { GeoPoint } from "@/services/geocoding/types";
import type { NewOrder } from "../model";
import { autoOrder, matchSuggestion, receiptBlock } from "./auto-printed";

export function useAutoPrinted({ active, orders, busy, defaultPromiseMinutes, store, save }: {
  /** Automatic mode on, with real data. */
  active: boolean;
  orders: PrintedOrder[];
  /** Another command is being saved: wait for it. */
  busy: boolean;
  defaultPromiseMinutes: number;
  store?: GeoPoint;
  /** Saves the order; true when it is in the panel. */
  save: (id: string, order: NewOrder) => Promise<boolean>;
}) {
  /** Printed order → why the store must check it. */
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const tried = useRef(new Set<string>());
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    if (!active || busy || working) return;
    const next = orders.find(item => !tried.current.has(item.id));
    if (!next) return;
    tried.current.add(next.id);
    // Not aborted when the effect runs again: the attempt itself changes `working`.
    const controller = new AbortController();
    const review = (reason: string) => setReviews(previous => ({ ...previous, [next.id]: reason }));
    async function attempt(item: PrintedOrder) {
      const blocked = receiptBlock(item);
      if (blocked) { review(blocked); return; }
      try {
        const suggestions = await suggestAddress(item.order.address!, controller.signal);
        const match = matchSuggestion(item.order.address!, suggestions);
        if (!match) { review("não achei esse endereço no mapa com certeza"); return; }
        const found = await resolveAddress(match.id, controller.signal);
        const result = autoOrder(item, found, defaultPromiseMinutes, store);
        if ("reason" in result) { review(result.reason); return; }
        if (!(await save(item.id, result.order))) review("não foi possível salvar sozinho");
      } catch {
        review("a busca de endereço não respondeu");
      }
    }
    setWorking(next.id);
    void attempt(next).finally(() => setWorking(null));
  }, [active, busy, working, orders, defaultPromiseMinutes, store, save]);

  return { reviews, working };
}
