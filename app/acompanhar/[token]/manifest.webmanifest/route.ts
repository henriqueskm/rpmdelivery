import { isTrackingToken } from "@/lib/tracking/links";

// "Adicionar à Tela de Início" from the tracking page opens this order again: on the iPhone, that is
// the only way a page can receive notifications. One manifest per order, so the icon keeps the link.
export async function GET(_request: Request, ctx: RouteContext<"/acompanhar/[token]/manifest.webmanifest">) {
  const token = (await ctx.params).token.toLowerCase();
  if (!isTrackingToken(token)) return new Response(null, { status: 404 });
  const path = `/acompanhar/${token}`;
  return new Response(JSON.stringify({
    id: path,
    name: "Acompanhar pedido",
    short_name: "Meu pedido",
    description: "Onde está o seu pedido, com avisos quando for a sua vez.",
    lang: "pt-BR",
    start_url: path,
    scope: path,
    display: "standalone",
    background_color: "#f6f7f2",
    theme_color: "#1d2c24",
    icons: [
      { src: "/courier/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/courier/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  }), {
    headers: {
      "content-type": "application/manifest+json",
      "cache-control": "private, max-age=3600",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    },
  });
}
