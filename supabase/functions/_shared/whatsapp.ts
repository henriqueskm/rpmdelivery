// WhatsApp Cloud API (Meta) message building and response handling.
// Pure: no Deno or Node APIs, so the Edge Function uses it and the unit
// tests run it under Node.

export type WhatsAppConfig = {
  token: string;
  phoneNumberId: string;
  /** "Saiu para entrega" (TRACKING_LINK). */
  template: string;
  /** "Você é o próximo" (NEXT_DELIVERY). */
  nextTemplate: string;
  language: string;
  graphVersion: string;
  siteUrl: string;
};

export type ClaimedNotification = {
  notificationId: string;
  type: string;
  to: string;
  trackingToken: string;
  restaurantName: string;
};

export type SendOutcome = {
  outcome: "SENT" | "RETRY" | "FAILED";
  providerMessageId?: string;
  error?: string;
};

const STORED_PHONE = /^\+55[1-9]{2}\d{8,9}$/;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Missing settings mean "not configured yet": nothing is claimed or sent.
export function readWhatsAppConfig(get: (name: string) => string | undefined): WhatsAppConfig | null {
  const token = get("WHATSAPP_TOKEN")?.trim();
  const phoneNumberId = get("WHATSAPP_PHONE_NUMBER_ID")?.trim();
  const siteUrl = get("PUBLIC_SITE_URL")?.trim();
  if (!token || !phoneNumberId || !/^\d{5,30}$/.test(phoneNumberId) || !siteUrl) return null;
  let origin: string;
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    origin = url.origin;
  } catch {
    return null;
  }
  return {
    token,
    phoneNumberId,
    template: get("WHATSAPP_TEMPLATE")?.trim() || "rpm_pedido_saiu",
    nextTemplate: get("WHATSAPP_TEMPLATE_NEXT")?.trim() || "rpm_voce_e_o_proximo",
    language: get("WHATSAPP_TEMPLATE_LANGUAGE")?.trim() || "pt_BR",
    graphVersion: get("WHATSAPP_GRAPH_VERSION")?.trim() || "v23.0",
    siteUrl: origin,
  };
}

// Both templates share one body shape: {{1}} store name, {{2}} public tracking link.
// The kind of message picks the template; an unknown kind is never sent.
export function messageFor(config: WhatsAppConfig, item: ClaimedNotification) {
  if (item.type === "TRACKING_LINK") return templateMessage(config, config.template, item);
  if (item.type === "NEXT_DELIVERY") return templateMessage(config, config.nextTemplate, item);
  throw new Error("UNSUPPORTED_TYPE");
}

// "Saiu para entrega": kept for callers and tests that build it directly.
export function routeStartedMessage(config: WhatsAppConfig, item: ClaimedNotification) {
  return templateMessage(config, config.template, item);
}

function templateMessage(config: WhatsAppConfig, template: string, item: ClaimedNotification) {
  if (!STORED_PHONE.test(item.to)) throw new Error("INVALID_PHONE");
  if (!TOKEN.test(item.trackingToken)) throw new Error("INVALID_TRACKING_TOKEN");
  const store = item.restaurantName.trim().replace(/\s+/g, " ").slice(0, 60);
  return {
    url: `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
    body: {
      messaging_product: "whatsapp",
      to: item.to.slice(1),
      type: "template",
      template: {
        name: template,
        language: { code: config.language },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: store },
            { type: "text", text: `${config.siteUrl}/acompanhar/${item.trackingToken.toLowerCase()}` },
          ],
        }],
      },
    },
  };
}

// 2xx with a message id: sent. 429 and 5xx: try again later. Other 4xx
// (bad number, template not approved, recipient not allowed on the test
// number): retrying would not help. Errors keep only Meta's code and
// message, never the phone.
export function classifyMetaResponse(status: number, payload: unknown): SendOutcome {
  const body = (payload ?? {}) as { messages?: { id?: unknown }[]; error?: { code?: unknown; message?: unknown } };
  if (status >= 200 && status < 300) {
    const id = body.messages?.[0]?.id;
    return typeof id === "string" && id
      ? { outcome: "SENT", providerMessageId: id }
      : { outcome: "RETRY", error: "META_NO_MESSAGE_ID" };
  }
  const code = typeof body.error?.code === "number" ? body.error.code : status;
  const message = typeof body.error?.message === "string" ? body.error.message : "";
  const error = `META_${code}${message ? `: ${message}` : ""}`.replace(/\+?\d{10,13}/g, "[phone]").slice(0, 300);
  return { outcome: status === 429 || status >= 500 ? "RETRY" : "FAILED", error };
}
