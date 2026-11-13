"use client";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { isTrackingToken } from "@/lib/tracking/links";
import { parseTracking, refreshSeconds, type Tracking } from "@/lib/tracking/view";

export type TrackingState =
  | { phase: "loading" }
  | { phase: "not-found" }
  | { phase: "error" }
  | { phase: "ready"; tracking: Tracking; offline: boolean };

// Retry interval while a page that already loaded has lost the connection.
const OFFLINE_RETRY_SECONDS = 15;

function isNotFound(error: { code?: string; message?: string }) {
  return error.code === "P0002" || !!error.message?.includes("RPM_TRACKING_NOT_FOUND");
}

/** Reads get_tracking and keeps refreshing while the page is visible. */
export function useTracking(token: string) {
  const valid = isTrackingToken(token);
  const [state, setState] = useState<TrackingState>(valid ? { phase: "loading" } : { phase: "not-found" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!valid) return;
    let active = true;
    let loaded = false;
    let timer: number | undefined;
    let paused = false;

    async function fetchOnce(): Promise<number | null> {
      try {
        const { data, error } = await getSupabase().rpc("get_tracking", { p_token: token }).retry(false);
        if (!active) return null;
        if (error && isNotFound(error)) { setState({ phase: "not-found" }); return null; }
        const tracking = error ? null : parseTracking(data);
        if (!tracking) throw error ?? new Error("Resposta de acompanhamento inválida.");
        loaded = true;
        setState({ phase: "ready", tracking, offline: false });
        return refreshSeconds(tracking.status);
      } catch {
        if (!active) return null;
        if (!loaded) { setState({ phase: "error" }); return null; }
        setState(current => current.phase === "ready" ? { ...current, offline: true } : current);
        return OFFLINE_RETRY_SECONDS;
      }
    }

    async function load() {
      timer = undefined;
      // A hidden tab stops polling; it refreshes as soon as it is visible again.
      if (document.visibilityState === "hidden") { paused = true; return; }
      const seconds = await fetchOnce();
      if (active && seconds !== null) timer = window.setTimeout(load, seconds * 1000);
    }

    function resume() {
      if (document.visibilityState !== "visible" || !paused) return;
      paused = false;
      void load();
    }

    void load();
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [token, valid, attempt]);

  function retry() {
    setState({ phase: "loading" });
    setAttempt(n => n + 1);
  }

  return { state, retry };
}
