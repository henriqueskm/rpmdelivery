import { test } from "node:test";
import assert from "node:assert/strict";
import { trackingMessage, trackingUrl, whatsAppLink } from "../../lib/tracking/links.ts";

const token = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";

test("link público usa só o token, em minúsculas, na origem do app", () => {
  assert.equal(trackingUrl("https://rpm.example", token),
    "https://rpm.example/acompanhar/3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  for (const bad of ["", "123", "3f2504e0-4f89-41d3-9a0c-0305e82c330", "../convite", `${token}?x=1`])
    assert.throws(() => trackingUrl("https://rpm.example", bad));
});

test("mensagens de saída e de próxima entrega levam loja e link", () => {
  const url = trackingUrl("https://rpm.example", token);
  assert.equal(trackingMessage("STARTED", "  Pizzaria   Boa ", url),
    `Olá! Seu pedido de Pizzaria Boa saiu para entrega. Acompanhe por aqui: ${url}`);
  assert.match(trackingMessage("NEXT", "Pizzaria Boa", url), /^Olá! Você é a próxima entrega de Pizzaria Boa\. .+ Acompanhe: https:/);
  assert.throws(() => trackingMessage("STARTED", "   ", url));
});

test("wa.me recebe o telefone salvo sem + e o texto codificado", () => {
  const link = whatsAppLink("+5511912345678", "Olá! Acompanhe: https://rpm.example/acompanhar/x?a=1&b=2");
  assert.equal(link, "https://wa.me/5511912345678?text=Ol%C3%A1!%20Acompanhe%3A%20https%3A%2F%2Frpm.example%2Facompanhar%2Fx%3Fa%3D1%26b%3D2");
  assert.equal(new URL(link).searchParams.get("text"), "Olá! Acompanhe: https://rpm.example/acompanhar/x?a=1&b=2");
  assert.equal(whatsAppLink("+551133334444", "x"), "https://wa.me/551133334444?text=x");
  for (const bad of ["11912345678", "+15551234567", "+5501912345678", "+55119123456789", "+55 11 91234-5678"])
    assert.throws(() => whatsAppLink(bad, "x"));
});
