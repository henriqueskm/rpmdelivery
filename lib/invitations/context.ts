const key = "rpmdelivery:invite:v1";
const ttl = 24 * 60 * 60 * 1000;
export function normalizeInviteCode(value: string): string | null {
  const code = value.trim().replace(/[-\s]/g, "").toLowerCase();
  return /^[a-f0-9]{20}$/.test(code) ? code : null;
}
export function formatInviteCode(value: string) {
  return value.toUpperCase().match(/.{1,4}/g)?.join("-") ?? "";
}
export function inviteLink(origin: string, value: string) {
  const code = normalizeInviteCode(value);
  const url = new URL("/convite", origin);
  if (!code || !["https:", "http:"].includes(url.protocol)) throw new Error("Código indisponível.");
  url.hash = "c=" + code;
  return url.href;
}
export function rememberInvite(code: string) {
  const normalized = normalizeInviteCode(code);
  if (!normalized) throw new Error("Confira o código do convite.");
  // Local only: never put the secret in a query string, Auth redirect or analytics.
  window.localStorage.setItem(key, JSON.stringify({ code: normalized, until: Date.now() + ttl }));
  window.dispatchEvent(new Event("rpmdelivery-invite"));
}
export function parseInviteContext(raw: string | null, now: number): string | null {
  try {
    const item = JSON.parse(raw ?? "null");
    if (typeof item?.until === "number" && item.until > now && item.until <= now + ttl && typeof item.code === "string") {
      return normalizeInviteCode(item.code);
    }
    return null;
  } catch { /* Unavailable storage is surfaced when saving a new invitation. */ }
  return null;
}
export function readInvite(): string | null {
  try { return parseInviteContext(window.localStorage.getItem(key), Date.now()); } catch { return null; }
}
export function clearExpiredInvite() {
  try { if (window.localStorage.getItem(key) && !readInvite()) forgetInvite(); } catch {}
}
export function forgetInvite() { try { window.localStorage.removeItem(key); window.dispatchEvent(new Event("rpmdelivery-invite")); } catch {} }
