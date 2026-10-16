"use client";
import { useSyncExternalStore } from "react";
import { readInvite, clearExpiredInvite } from "@/lib/invitations/context";
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener("rpmdelivery-invite", notify);
  clearExpiredInvite();
  return () => { window.removeEventListener("storage", notify); window.removeEventListener("rpmdelivery-invite", notify); };
}
export function useInviteCode() { return useSyncExternalStore(subscribe, readInvite, () => null); }
