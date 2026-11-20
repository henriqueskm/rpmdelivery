"use client";
import { useEffect, useState } from "react";
import { isTrackingToken, trackingUrl } from "@/lib/tracking/links";

/**
 * Copies the customer's tracking link (/acompanhar/…) so the store can send it by hand, e.g. on
 * WhatsApp. Without clipboard access the link is shown to copy manually. Nothing is sent from here.
 */
export function CopyTrackingLink({ token, reference, className = "ops-order-edit-promise" }: {
  token?: string; reference: string; className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const [link, setLink] = useState("");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  if (!token || !isTrackingToken(token)) return null;
  async function copy() {
    const url = trackingUrl(window.location.origin, token!);
    setLink(url);
    try { await navigator.clipboard.writeText(url); setState("copied"); }
    catch { setState("manual"); }
  }
  return <>
    <button type="button" className={className} onClick={() => void copy()}
      aria-label={`Copiar link de acompanhamento do pedido ${reference}`}>
      {state === "copied" ? "Link copiado ✓" : "Copiar link"}
    </button>
    {state === "copied" && <span className="ops-visually-hidden" role="status">Link do pedido {reference} copiado.</span>}
    {state === "manual" && <input className="ops-link-manual" readOnly value={link} aria-label={`Link do pedido ${reference}`}
      onFocus={event => event.currentTarget.select()} autoFocus />}
  </>;
}
