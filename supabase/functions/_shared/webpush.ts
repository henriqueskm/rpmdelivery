// Browser notifications: Web Push (RFC 8030) signed with VAPID (RFC 8292),
// payload encrypted with aes128gcm (RFC 8291).
// WebCrypto only, no Deno or Node APIs: the Edge Function uses it and the unit
// tests run it under Node.

export type PushConfig = {
  /** Uncompressed P-256 public key, base64url (65 bytes). Also NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY on the site. */
  publicKey: string;
  /** P-256 private scalar, base64url (32 bytes). A secret: Supabase secrets only. */
  privateKey: string;
  /** Who to contact about this sender (RFC 8292): the site's https origin by default. */
  subject: string;
};

export type PushSubscriptionKeys = { id: string; endpoint: string; p256dh: string; auth: string };

export type ClaimedPush = {
  notificationId: string;
  type: string;
  trackingToken: string;
  restaurantName: string;
  subscriptions: PushSubscriptionKeys[];
};

export type PushMessage = { title: string; body: string; tag: string; url: string; icon: string; badge: string };

/** Same list as private.valid_push_endpoint in the database: the dispatcher only ever posts to push services. */
export const PUSH_ENDPOINT =
  /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)\/[A-Za-z0-9._~%:/?=&+-]+$/;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** How long the push service may hold a message for an offline phone: "chegando" later than this is wrong. */
export const PUSH_TTL_SECONDS = 900;

const encoder = new TextEncoder();

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function decodes(value: string | undefined, length: number) {
  if (!value || !/^[A-Za-z0-9_-]+=*$/.test(value)) return false;
  try { return fromBase64Url(value).length === length; } catch { return false; }
}

// Missing or malformed keys mean "not configured yet": nothing is claimed or sent.
export function readPushConfig(get: (name: string) => string | undefined): PushConfig | null {
  const publicKey = get("WEB_PUSH_PUBLIC_KEY")?.trim();
  const privateKey = get("WEB_PUSH_PRIVATE_KEY")?.trim();
  if (!decodes(publicKey, 65) || fromBase64Url(publicKey!)[0] !== 4 || !decodes(privateKey, 32)) return null;
  let subject = get("WEB_PUSH_SUBJECT")?.trim();
  if (!subject) {
    try {
      const url = new URL(get("PUBLIC_SITE_URL")?.trim() ?? "");
      if (url.protocol !== "https:") return null;
      subject = url.origin;
    } catch { return null; }
  }
  if (!/^(https:\/\/|mailto:)\S+$/.test(subject)) return null;
  return { publicKey: publicKey!, privateKey: privateKey!, subject };
}

const COPY: Record<string, (store: string) => { title: string; body: string }> = {
  TRACKING_LINK: store => ({ title: "Seu pedido saiu para entrega", body: `${store}: acompanhe o entregador pelo mapa.` }),
  NEXT_DELIVERY: store => ({ title: "Você é o próximo!", body: `O entregador de ${store} está indo até você agora.` }),
  COURIER_NEARBY: store => ({ title: "O entregador está chegando", body: `Seu pedido de ${store} está quase aí. Fique de olho na porta.` }),
  DELIVERY_COMPLETED: store => ({ title: "Pedido entregue", body: `Bom apetite! Obrigado por pedir em ${store}.` }),
};

/** What the service worker shows. The link is relative: the worker opens it on the site's own origin. */
export function pushMessage(item: ClaimedPush): PushMessage {
  const copy = COPY[item.type];
  if (!copy) throw new Error("UNSUPPORTED_TYPE");
  if (!TOKEN.test(item.trackingToken)) throw new Error("INVALID_TRACKING_TOKEN");
  const token = item.trackingToken.toLowerCase();
  const store = item.restaurantName.trim().replace(/\s+/g, " ").slice(0, 60);
  return {
    ...copy(store),
    // One notification per order in the tray: each new one replaces the last.
    tag: `rpm-${token}`,
    url: `/acompanhar/${token}`,
    icon: "/courier/notify-192.png",
    badge: "/courier/badge-96.png",
  };
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/**
 * RFC 8291 body: salt (16) | record size (4) | key id length (1) | server public key (65) | ciphertext.
 * `fixed` exists for tests only (known salt and server keys).
 */
export async function encryptPayload(
  payload: Uint8Array, p256dh: string, auth: string,
  fixed?: { salt: Uint8Array<ArrayBuffer>; serverKeys: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer>> {
  const clientPublic = fromBase64Url(p256dh);
  const authSecret = fromBase64Url(auth);
  if (clientPublic.length !== 65 || clientPublic[0] !== 4 || authSecret.length !== 16) throw new Error("INVALID_SUBSCRIPTION_KEYS");
  const clientKey = await crypto.subtle.importKey("raw", clientPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const serverKeys = fixed?.serverKeys
    ?? await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, serverKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(encoder.encode("WebPush: info\0"), clientPublic, serverPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // A single record: the payload, then the last-record delimiter (0x02), no padding.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = serverPublic.length;
  return concat(header, serverPublic, cipher);
}

/** `vapid t=<JWT signed ES256 for the push service's origin>, k=<public key>`, valid 12 hours. */
export async function vapidAuthorization(endpoint: string, config: PushConfig, nowSeconds = Math.floor(Date.now() / 1000)) {
  const publicKey = fromBase64Url(config.publicKey);
  const signing = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", d: config.privateKey.replace(/=+$/, ""),
    x: toBase64Url(publicKey.slice(1, 33)), y: toBase64Url(publicKey.slice(33, 65)), ext: true,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = (value: object) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: config.subject,
  })}`;
  // WebCrypto returns the raw r|s pair JWS expects.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signing, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${config.publicKey.replace(/=+$/, "")}`;
}

/** The request for one browser. Throws for an endpoint outside the push services. */
export async function pushRequest(config: PushConfig, subscription: PushSubscriptionKeys, message: PushMessage, topic: string) {
  if (!PUSH_ENDPOINT.test(subscription.endpoint)) throw new Error("INVALID_ENDPOINT");
  const body = await encryptPayload(encoder.encode(JSON.stringify(message)), subscription.p256dh, subscription.auth);
  return {
    url: subscription.endpoint,
    init: {
      method: "POST",
      redirect: "manual" as const,
      headers: {
        authorization: await vapidAuthorization(subscription.endpoint, config),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(PUSH_TTL_SECONDS),
        urgency: "high",
        // A newer push for the same order replaces one still waiting for the phone.
        // (At most 32 URL-safe characters: the order's token without its dashes.)
        topic: topic.replace(/[^A-Za-z0-9]/g, "").slice(0, 32),
      },
      body,
    },
  };
}

export type PushOutcome = { outcome: "SENT" | "RETRY" | "GONE" | "FAILED"; error?: string };

// 2xx: accepted. 404/410: the browser unsubscribed or expired, stop sending to it.
// 429 and 5xx: try again later. Anything else (bad key, payload too large): retrying would not help.
export function classifyPushResponse(status: number): PushOutcome {
  if (status >= 200 && status < 300) return { outcome: "SENT" };
  if (status === 404 || status === 410) return { outcome: "GONE", error: `PUSH_${status}` };
  if (status === 429 || status >= 500) return { outcome: "RETRY", error: `PUSH_${status}` };
  return { outcome: "FAILED", error: `PUSH_${status}` };
}

/** One notification, many browsers: delivered to any is sent; otherwise retry if any can be retried. */
export function combinePushOutcomes(results: PushOutcome[]): { outcome: "SENT" | "RETRY" | "FAILED"; error?: string } {
  if (results.length === 0) return { outcome: "FAILED", error: "NO_SUBSCRIPTION" };
  if (results.some(result => result.outcome === "SENT")) return { outcome: "SENT" };
  const retry = results.find(result => result.outcome === "RETRY");
  if (retry) return { outcome: "RETRY", error: retry.error };
  return { outcome: "FAILED", error: results[0].error ?? "PUSH_FAILED" };
}
