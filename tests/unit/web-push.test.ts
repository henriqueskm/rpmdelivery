import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUSH_ENDPOINT, classifyPushResponse, combinePushOutcomes, encryptPayload, fromBase64Url, pushMessage,
  pushRequest, readPushConfig, toBase64Url, vapidAuthorization,
} from "../../supabase/functions/_shared/webpush.ts";

const env = (values: Record<string, string>) => (name: string) => values[name];
const enc = new TextEncoder();

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: string | Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bytes = typeof info === "string" ? enc.encode(info) : info;
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: bytes }, key, length * 8));
}

/** The browser's side of RFC 8291, written from the RFC, to check what the sender produces. */
async function decrypt(body: Uint8Array<ArrayBuffer>, client: CryptoKeyPair, auth: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16);
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(body[20], 65);
  const serverPublic = body.slice(21, 86);
  const clientPublic = new Uint8Array(await crypto.subtle.exportKey("raw", client.publicKey));
  const serverKey = await crypto.subtle.importKey("raw", serverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: serverKey }, client.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...clientPublic, ...serverPublic]);
  const ikm = await hkdf(auth, shared, info, 32);
  const cek = await crypto.subtle.importKey("raw", await hkdf(salt, ikm, "Content-Encoding: aes128gcm\0", 16), "AES-GCM", false, ["decrypt"]);
  const nonce = await hkdf(salt, ikm, "Content-Encoding: nonce\0", 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cek, body.slice(86)));
  assert.equal(plain[plain.length - 1], 2, "last record delimiter");
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!;
  return { pair, publicKey, privateKey };
}

const token = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";
const claimed = (type: string) => ({ notificationId: "n1", type, trackingToken: token, restaurantName: "  Pizzaria   Boa ", subscriptions: [] });

test("sem chaves válidas as notificações ficam desligadas", async () => {
  const { publicKey, privateKey } = await vapidKeys();
  const base = { WEB_PUSH_PUBLIC_KEY: publicKey, WEB_PUSH_PRIVATE_KEY: privateKey, PUBLIC_SITE_URL: "https://rpm.example/app" };
  assert.equal(readPushConfig(env({})), null);
  assert.equal(readPushConfig(env({ ...base, WEB_PUSH_PRIVATE_KEY: "curta" })), null);
  assert.equal(readPushConfig(env({ ...base, WEB_PUSH_PUBLIC_KEY: privateKey })), null);
  assert.equal(readPushConfig(env({ ...base, PUBLIC_SITE_URL: "http://rpm.example" })), null);
  assert.deepEqual(readPushConfig(env(base)), { publicKey, privateKey, subject: "https://rpm.example" });
  assert.equal(readPushConfig(env({ ...base, WEB_PUSH_SUBJECT: "mailto:contato@rpm.example" }))?.subject, "mailto:contato@rpm.example");
});

test("mensagem de cada aviso, com o link relativo do pedido", () => {
  assert.deepEqual(pushMessage(claimed("COURIER_NEARBY")), {
    title: "O entregador está chegando", body: "Seu pedido de Pizzaria Boa está quase aí. Fique de olho na porta.",
    tag: `rpm-${token.toLowerCase()}`, url: `/acompanhar/${token.toLowerCase()}`,
    icon: "/courier/notify-192.png", badge: "/courier/badge-96.png",
  });
  assert.equal(pushMessage(claimed("NEXT_DELIVERY")).title, "Você é o próximo!");
  assert.equal(pushMessage(claimed("TRACKING_LINK")).title, "Seu pedido saiu para entrega");
  assert.equal(pushMessage(claimed("DELIVERY_COMPLETED")).title, "Pedido entregue");
  assert.throws(() => pushMessage(claimed("DELIVERY_CANCELLED")), /UNSUPPORTED_TYPE/);
  assert.throws(() => pushMessage({ ...claimed("NEXT_DELIVERY"), trackingToken: "../x" }), /INVALID_TRACKING_TOKEN/);
});

test("só endereços dos serviços de push", () => {
  for (const ok of ["https://fcm.googleapis.com/fcm/send/abc:XY_z-1", "https://web.push.apple.com/QGx1",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAA", "https://wns2-bn3p.notify.windows.com/w/?token=AbC%2B"]) {
    assert.ok(PUSH_ENDPOINT.test(ok), ok);
  }
  for (const bad of ["http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.example/x",
    "https://evil.example/fcm.googleapis.com/", "https://localhost/x", "https://fcm.googleapis.com@evil.example/x"]) {
    assert.ok(!PUSH_ENDPOINT.test(bad), bad);
  }
});

test("RFC 8291, apêndice A: mesmo corpo cifrado do exemplo", async () => {
  const asPublic = fromBase64Url("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const jwk = { kty: "EC", crv: "P-256", d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    x: toBase64Url(asPublic.slice(1, 33)), y: toBase64Url(asPublic.slice(33, 65)), ext: true };
  const serverKeys = {
    privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, true, []),
  } as CryptoKeyPair;
  const body = await encryptPayload(enc.encode("When I grow up, I want to be a watermelon"),
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", "BTBZMqHH6r4Tts7J_aSIgg",
    { salt: fromBase64Url("DGv6ra1nlYgDCS1FRnbzlw"), serverKeys });
  assert.equal(toBase64Url(body),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("o navegador decifra a mensagem e o push service confere a assinatura VAPID", async () => {
  const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const { pair, publicKey, privateKey } = await vapidKeys();
  const config = { publicKey, privateKey, subject: "https://rpm.example" };
  const subscription = {
    id: "s1", endpoint: "https://fcm.googleapis.com/fcm/send/abc:XYZ",
    p256dh: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", client.publicKey))), auth: toBase64Url(auth),
  };
  const message = pushMessage(claimed("NEXT_DELIVERY"));
  const request = await pushRequest(config, subscription, message, token);
  assert.equal(request.url, subscription.endpoint);
  assert.equal(request.init.redirect, "manual");
  assert.equal(request.init.headers["content-encoding"], "aes128gcm");
  assert.equal(request.init.headers.ttl, "900");
  assert.equal(request.init.headers.topic, "3F2504E04F8941D39A0C0305E82C3301");
  assert.deepEqual(JSON.parse(await decrypt(request.init.body, client, auth)), message);

  const [, jwt, key] = /^vapid t=([^,]+), k=(.+)$/.exec(request.init.headers.authorization)!;
  assert.equal(key, publicKey);
  const [head, claims, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromBase64Url(head))), { typ: "JWT", alg: "ES256" });
  const body = JSON.parse(new TextDecoder().decode(fromBase64Url(claims)));
  assert.equal(body.aud, "https://fcm.googleapis.com");
  assert.equal(body.sub, "https://rpm.example");
  assert.ok(body.exp > Date.now() / 1000 && body.exp <= Date.now() / 1000 + 24 * 3600);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey,
    fromBase64Url(signature), enc.encode(`${head}.${claims}`)));

  await assert.rejects(pushRequest(config, { ...subscription, endpoint: "https://evil.example/x" }, message, token), /INVALID_ENDPOINT/);
  const fixedNow = await vapidAuthorization(subscription.endpoint, config, 1_000);
  assert.equal(JSON.parse(new TextDecoder().decode(fromBase64Url(fixedNow.split(".")[1]))).exp, 1_000 + 12 * 3600);
});

test("resposta do serviço de push e resultado por aviso", () => {
  assert.deepEqual(classifyPushResponse(201), { outcome: "SENT" });
  assert.deepEqual(classifyPushResponse(410), { outcome: "GONE", error: "PUSH_410" });
  assert.deepEqual(classifyPushResponse(404), { outcome: "GONE", error: "PUSH_404" });
  assert.deepEqual(classifyPushResponse(429), { outcome: "RETRY", error: "PUSH_429" });
  assert.deepEqual(classifyPushResponse(503), { outcome: "RETRY", error: "PUSH_503" });
  assert.deepEqual(classifyPushResponse(403), { outcome: "FAILED", error: "PUSH_403" });
  assert.deepEqual(combinePushOutcomes([]), { outcome: "FAILED", error: "NO_SUBSCRIPTION" });
  assert.deepEqual(combinePushOutcomes([classifyPushResponse(410), classifyPushResponse(201)]), { outcome: "SENT" });
  assert.deepEqual(combinePushOutcomes([classifyPushResponse(410), classifyPushResponse(503)]), { outcome: "RETRY", error: "PUSH_503" });
  assert.deepEqual(combinePushOutcomes([classifyPushResponse(410)]), { outcome: "FAILED", error: "PUSH_410" });
});
