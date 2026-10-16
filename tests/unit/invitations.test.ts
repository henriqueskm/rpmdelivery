import test from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import { inviteLink, normalizeInviteCode, formatInviteCode, parseInviteContext } from "../../lib/invitations/context.ts";
import { inviteQr } from "../../lib/invitations/qr.ts";

test("convite normaliza somente 80 bits hexadecimais e não aceita URL externa como código", () => {
  assert.equal(normalizeInviteCode("ABCD-EF12-3456-7890-ABCD"), "abcdef1234567890abcd");
  for (const value of ["", "ab", "javascript:alert(1)", "https://outside.test", "g".repeat(20)]) assert.equal(normalizeInviteCode(value), null);
  assert.equal(formatInviteCode("abcdef1234567890abcd"), "ABCD-EF12-3456-7890-ABCD");
});
test("convite mantém segredo no fragmento da própria origem, sem query", () => {
  const url = new URL(inviteLink("https://app.fixture.invalid/any/path", "abcdef1234567890abcd"));
  assert.equal(url.origin, "https://app.fixture.invalid");
  assert.equal(url.pathname, "/convite"); assert.equal(url.search, "");
  assert.equal(url.hash, "#c=abcdef1234567890abcd");
  assert.throws(() => inviteLink("javascript:foo", "abcdef1234567890abcd"));
});
test("contexto rejeita JSON inválido, expirado e validade manipulada acima de 24h", () => {
  const code = "abcdef1234567890abcd";
  assert.equal(parseInviteContext(JSON.stringify({code,until:2000}),1000),code);
  assert.equal(parseInviteContext(JSON.stringify({code,until:1000}),1000),null);
  assert.equal(parseInviteContext(JSON.stringify({code,until:1000+86400001}),1000),null);
  assert.equal(parseInviteContext("not-json",1000),null);
});
test("QR local é decodificável e abre exatamente o mesmo link, com quiet zone", () => {
  const value = inviteLink("https://app.fixture.invalid", "abcdef1234567890abcd"), qr = inviteQr(value);
  const scale = 8, size = (qr.getModuleCount() + 8) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / scale) - 4, col = Math.floor(x / scale) - 4;
    if (row >= 0 && col >= 0 && row < qr.getModuleCount() && col < qr.getModuleCount() && qr.isDark(row, col)) {
      const offset = (y * size + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    }
  }
  assert.equal(jsQR(pixels, size, size)?.data, value);
});
