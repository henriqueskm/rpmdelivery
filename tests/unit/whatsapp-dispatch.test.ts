import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMetaResponse, messageFor, readWhatsAppConfig, routeStartedMessage }
  from "../../supabase/functions/_shared/whatsapp.ts";

const env = (values: Record<string, string>) => (name: string) => values[name];
const base = { WHATSAPP_TOKEN: "test-token", WHATSAPP_PHONE_NUMBER_ID: "123456789012345", PUBLIC_SITE_URL: "https://rpm.example/app" };
const item = {
  notificationId: "n1", type: "TRACKING_LINK", to: "+5511912345678",
  trackingToken: "3F2504E0-4F89-41D3-9A0C-0305E82C3301", restaurantName: "  Pizzaria   Boa ",
};

test("sem token, número ou site o envio fica desligado", () => {
  assert.equal(readWhatsAppConfig(env({})), null);
  assert.equal(readWhatsAppConfig(env({ ...base, WHATSAPP_TOKEN: " " })), null);
  assert.equal(readWhatsAppConfig(env({ ...base, WHATSAPP_PHONE_NUMBER_ID: "abc" })), null);
  assert.equal(readWhatsAppConfig(env({ ...base, PUBLIC_SITE_URL: "http://rpm.example" })), null);
  assert.equal(readWhatsAppConfig(env({ ...base, PUBLIC_SITE_URL: "not a url" })), null);
  assert.deepEqual(readWhatsAppConfig(env(base)), {
    token: "test-token", phoneNumberId: "123456789012345", template: "rpm_pedido_saiu",
    nextTemplate: "rpm_voce_e_o_proximo", language: "pt_BR", graphVersion: "v23.0", siteUrl: "https://rpm.example",
  });
  assert.equal(readWhatsAppConfig(env({ ...base, WHATSAPP_TEMPLATE_NEXT: "proximo_teste" }))?.nextTemplate, "proximo_teste");
  assert.equal(readWhatsAppConfig(env({ ...base, WHATSAPP_TEMPLATE: "hello_world", WHATSAPP_GRAPH_VERSION: "v24.0" }))?.template, "hello_world");
});

test("mensagem de modelo com loja e link, para o número sem +", () => {
  const config = readWhatsAppConfig(env(base))!;
  const message = routeStartedMessage(config, item);
  assert.equal(message.url, "https://graph.facebook.com/v23.0/123456789012345/messages");
  assert.deepEqual(message.body, {
    messaging_product: "whatsapp", to: "5511912345678", type: "template",
    template: { name: "rpm_pedido_saiu", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [
      { type: "text", text: "Pizzaria Boa" },
      { type: "text", text: "https://rpm.example/acompanhar/3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
    ] }] },
  });
  assert.throws(() => routeStartedMessage(config, { ...item, to: "11912345678" }), /INVALID_PHONE/);
  assert.throws(() => routeStartedMessage(config, { ...item, trackingToken: "../x" }), /INVALID_TRACKING_TOKEN/);
});

test("o tipo do aviso escolhe o modelo: saiu para entrega ou você é o próximo", () => {
  const config = readWhatsAppConfig(env(base))!;
  assert.equal(messageFor(config, item).body.template.name, "rpm_pedido_saiu");
  const next = messageFor(config, { ...item, type: "NEXT_DELIVERY" });
  assert.equal(next.body.template.name, "rpm_voce_e_o_proximo");
  assert.deepEqual(next.body.template.components, routeStartedMessage(config, item).body.template.components);
  assert.throws(() => messageFor(config, { ...item, type: "DELIVERY_COMPLETED" }), /UNSUPPORTED_TYPE/);
});

test("resposta da Meta: enviado, tentar de novo ou falha definitiva, sem telefone no erro", () => {
  assert.deepEqual(classifyMetaResponse(200, { messages: [{ id: "wamid.ABC" }] }), { outcome: "SENT", providerMessageId: "wamid.ABC" });
  assert.equal(classifyMetaResponse(200, {}).outcome, "RETRY");
  assert.equal(classifyMetaResponse(429, { error: { code: 130429, message: "rate" } }).outcome, "RETRY");
  assert.equal(classifyMetaResponse(503, null).outcome, "RETRY");
  const failed = classifyMetaResponse(400, { error: { code: 131030, message: "Recipient +5511912345678 not in allowed list" } });
  assert.equal(failed.outcome, "FAILED");
  assert.equal(failed.error, "META_131030: Recipient [phone] not in allowed list");
  assert.equal(classifyMetaResponse(401, "html").error, "META_401");
});
