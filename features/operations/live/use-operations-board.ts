"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { parseBoard, type Board } from "./board";

export type BoardState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; board: Board; receivedAt: number; offline: boolean };

/** The panel refreshes on its own: couriers act from their phones. */
export const BOARD_REFRESH_MS = 5_000;

/**
 * Reads get_operations_board, every 5 s while the tab is visible and right
 * after each command. A failure after the first load keeps the last board on
 * screen, flagged offline.
 */
export function useOperationsBoard(restaurantId: string) {
  const [state, setState] = useState<BoardState>({ status: "loading" });
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    // One read at a time, in order: a read that started before a command
    // must not land after the read that follows it.
    while (inFlight.current) await inFlight.current;
    inFlight.current = (async () => {
      try {
        const { data, error } = await getSupabase().rpc("get_operations_board", { p_restaurant_id: restaurantId });
        const board = error ? null : parseBoard(data);
        if (!board) throw error ?? new Error("Resposta inesperada do painel.");
        setState({ status: "ready", board, receivedAt: Date.now(), offline: false });
      } catch {
        setState(current => current.status === "ready" ? { ...current, offline: true } : { status: "error" });
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [restaurantId]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped || document.visibilityState === "hidden") return;
      timer = window.setTimeout(async () => {
        await refresh();
        schedule();
      }, BOARD_REFRESH_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh().then(schedule);
      else window.clearTimeout(timer);
    };
    void refresh().then(schedule);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { state, refresh, retry };
}
