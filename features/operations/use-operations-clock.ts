import { useSyncExternalStore } from "react";

// One clock for the workspace, regardless of the number of orders or panels.
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function refresh() {
  current = Date.now();
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    refresh();
    timer = setInterval(refresh, 1_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      current = 0;
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", refresh);
    }
  };
}
const snapshot = () => current;
const serverSnapshot = () => 0;
export function useOperationsClock() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
