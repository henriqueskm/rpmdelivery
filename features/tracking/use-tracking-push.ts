"use client";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Browser notifications for one order ("saiu", "você é o próximo", "está chegando", "entregue").
 * - unavailable: this browser cannot receive them, or the site has no key yet: nothing to offer.
 * - install: iPhone/iPad in Safari: only a page added to the home screen can receive them.
 * - off / working / on / denied / failed: the button's states.
 */
export type PushState = "unavailable" | "install" | "off" | "working" | "on" | "denied" | "failed";

const SCOPE = "/acompanhar/";
const remembered = (token: string) => `rpm-push:${token}`;

function publicKey() {
  const key = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY?.trim();
  return key && /^[A-Za-z0-9_-]{86,88}=*$/.test(key) ? key : null;
}

function keyBytes(base64url: string) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function readFlag(token: string) {
  try { return window.localStorage.getItem(remembered(token)) === "on"; } catch { return false; }
}
function writeFlag(token: string, on: boolean) {
  try {
    if (on) window.localStorage.setItem(remembered(token), "on");
    else window.localStorage.removeItem(remembered(token));
  } catch { /* Private mode: the state is only lost on reload. */ }
}

export function useTrackingPush(token: string, live: boolean) {
  const [state, setState] = useState<PushState>("unavailable");

  // What this browser can do, and whether this order is already on (asked before, permission kept).
  useEffect(() => {
    if (!live || !publicKey()) return;
    let active = true;
    const decide = async (): Promise<PushState> => {
      if (!supported()) return isAppleMobile() && !isInstalled() ? "install" : "unavailable";
      if (Notification.permission === "denied") return "denied";
      if (Notification.permission !== "granted" || !readFlag(token)) return "off";
      const registration = await navigator.serviceWorker.getRegistration(SCOPE);
      const subscription = await registration?.pushManager.getSubscription();
      return subscription ? "on" : "off";
    };
    decide().then(next => { if (active) setState(next); }).catch(() => { if (active) setState("off"); });
    return () => { active = false; };
  }, [token, live]);

  const enable = useCallback(async () => {
    const key = publicKey();
    if (!key) return;
    setState("working");
    try {
      // Asked only after the tap: browsers block a permission prompt nobody asked for.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "off"); return; }
      await navigator.serviceWorker.register("/tracking-sw.js", { scope: SCOPE, updateViaCache: "none" });
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription()
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("Inscrição sem chaves.");
      const { error } = await getSupabase().rpc("subscribe_tracking_push", {
        p_token: token, p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
      });
      if (error) throw error;
      writeFlag(token, true);
      setState("on");
    } catch {
      setState("failed");
    }
  }, [token]);

  const disable = useCallback(async () => {
    setState("working");
    try {
      const registration = await navigator.serviceWorker.getRegistration(SCOPE);
      const subscription = await registration?.pushManager.getSubscription();
      // The browser keeps its subscription (another order may use it); this order stops sending.
      if (subscription) {
        const { error } = await getSupabase().rpc("unsubscribe_tracking_push", { p_token: token, p_endpoint: subscription.endpoint });
        if (error) throw error;
      }
      writeFlag(token, false);
      setState("off");
    } catch {
      setState("on");
    }
  }, [token]);

  return { state: live ? state : "unavailable" as PushState, enable, disable };
}
