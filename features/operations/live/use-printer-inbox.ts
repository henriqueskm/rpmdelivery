"use client";
// Real data, opt-in per computer: asks the virtual printer program on this computer (127.0.0.1) for the
// orders it read from printed receipts. Off by default, so no other store's browser ever reaches it.

import { useCallback, useEffect, useState } from "react";
import { PANEL_HEADER, PRINTER_INBOX_URL, parsePrintedOrders, type PrintedOrder } from "@/lib/printing/printer-inbox";

const KEY = "rpm:printer-inbox";
const POLL_MS = 3000;
const RETRY_MS = 10_000;

/** off: the store did not turn it on here. waiting: first answer pending. unreachable: the program is not open. */
export type PrinterStatus = "off" | "waiting" | "connected" | "unreachable";

// Shown only with real data, which loads in the browser: no server render to match.
function readEnabled() {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(KEY) === "on"; } catch { return false; }
}

/** [active]: real data is on screen (the demo never asks the program). */
export function usePrinterInbox(active: boolean) {
  const [enabled, setEnabledState] = useState(readEnabled);
  const [orders, setOrders] = useState<PrintedOrder[]>([]);
  const [status, setStatus] = useState<Exclude<PrinterStatus, "off">>("waiting");

  useEffect(() => {
    if (!enabled || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      let reached = false;
      try {
        const response = await fetch(`${PRINTER_INBOX_URL}/pedidos`, { headers: { [PANEL_HEADER]: "1" }, cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = parsePrintedOrders(await response.json());
        reached = true;
        if (!stopped) { setOrders(next); setStatus("connected"); }
      } catch {
        if (!stopped) { setOrders([]); setStatus("unreachable"); }
      }
      if (!stopped) timer = setTimeout(poll, reached ? POLL_MS : RETRY_MS);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [enabled, active]);

  const setEnabled = useCallback((value: boolean) => {
    try { window.localStorage.setItem(KEY, value ? "on" : "off"); } catch { /* private mode: this visit only */ }
    setOrders([]);
    setStatus("waiting");
    setEnabledState(value);
  }, []);

  /** Saved or discarded: the program drops it, and it leaves the banner now. */
  const take = useCallback(async (id: string) => {
    setOrders(list => list.filter(item => item.id !== id));
    try {
      await fetch(`${PRINTER_INBOX_URL}/pedidos/${encodeURIComponent(id)}/concluido`,
        { method: "POST", headers: { [PANEL_HEADER]: "1" } });
    } catch { /* the program closed: it forgets the order anyway */ }
  }, []);

  return { enabled, setEnabled, status: enabled ? status : "off" as PrinterStatus, orders: enabled ? orders : [], take };
}
