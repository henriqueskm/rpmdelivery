import { test, expect, type Page } from "@playwright/test";
import { emptyBoard, mockSupabase } from "./support/supabase";

test.use({ timezoneId: "America/Sao_Paulo" });

const token = (n: number) => `0b6f1c2a-3d4e-4f50-8a6b-7c8d9e0f1a2${n}`;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** A store with one route on the street: one stop delivered at 10:25, the next with its pin, the courier on GPS. */
function board() {
  const order = (id: string, ref: string, customer: string, deliveryStatus: string, extra: object = {}) => ({
    deliveryId: id, orderId: `o-${id}`, reference: ref, customer, phone: "+5511988887777",
    address: `Rua ${ref}, 1`, neighborhood: "Centro", complement: null, notes: null,
    orderedAt: minutesAgo(40), createdAt: minutesAgo(40), promisedMinutes: 60,
    orderStatus: deliveryStatus === "DELIVERED" ? "DELIVERED" : deliveryStatus === "WAITING" ? "OPEN" : "DELIVERING",
    deliveryStatus, failedAttempts: 0, ...extra,
  });
  return {
    ...emptyBoard(),
    couriers: [{ shiftId: "s-1", name: "Ana Souza", status: "ON_ROUTE", linkActive: true, requestedAt: minutesAgo(90), availableSince: minutesAgo(60) }],
    routes: [{ id: "r-1", reference: "R-1", shiftId: "s-1", status: "ON_ROUTE", compositionVersion: 1,
      pickupReleasedAt: minutesAgo(30), startedAt: minutesAgo(25), deliveryIds: ["d-1", "d-2"], retryDeliveryIds: [] }],
    orders: [
      order("d-1", "2001", "Helena Prado", "DELIVERED"),
      order("d-2", "2002", "Igor Nunes", "NEXT", { latitude: -23.0048, longitude: -46.8371 }),
      order("d-3", "2003", "Júlia Reis", "WAITING"),
    ],
    routeOutcomes: [{ routeId: "r-1", deliveryId: "d-1", outcome: "DELIVERED", at: "2026-11-21T13:25:00Z" }],
    routePositions: [{ routeId: "r-1", latitude: -23.0052, longitude: -46.8380, recordedAt: minutesAgo(1) }],
    trackingTokens: [1, 2, 3].map(n => ({ deliveryId: `d-${n}`, token: token(n) })),
    storeLocation: { latitude: -23.0058, longitude: -46.8389 },
  };
}

async function openPanel(page: Page) {
  await mockSupabase(page, { existing: true, rpc: { get_operations_board: () => ({ json: board() }) } });
  // Minimal offline style: no real Mapbox request, no tiles, no public token.
  await page.route(/^https:\/\/(api|events)\.mapbox\.com\//, route => {
    if (!new URL(route.request().url()).pathname.startsWith("/styles/v1/mapbox/streets-v12")) return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ json: { version: 8, name: "e2e", sources: {},
      layers: [{ id: "fundo", type: "background", paint: { "background-color": "#ecf1e7" } }] } });
  });
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill("operador@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("Test-only-password-123!");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Acompanhar rotas" })).toBeVisible();
}

test("acompanhar rotas: mini mapa com loja, motoboy e próxima entrega; horário de cada entrega", async ({ page }) => {
  await openPanel(page);
  await page.getByRole("button", { name: "Acompanhar rotas" }).click();
  const tracker = page.getByRole("dialog", { name: "Acompanhar rotas" });
  const map = tracker.getByRole("region", { name: "Mapa com a loja e 1 motoboy na rua" });
  await expect(map).toBeVisible();
  await expect(map.locator(".ops-map-marker-store")).toHaveText("Loja");
  await expect(map.locator(".ops-map-marker-courier")).toHaveText("R-1");
  await expect(map.locator(".ops-map-marker-stop")).toHaveText("#2002");
  const route = tracker.getByRole("article", { name: "Rota R-1", exact: true });
  await expect(route).toContainText("Saiu há 25 min · 1 de 2 entregues");
  await expect(route.locator(".ops-tracker-stop").nth(0)).toContainText("Entregue às 10:25");
  // Closing the screen removes the map (Mapbox bills each map created).
  await page.keyboard.press("Escape");
  await expect(tracker).toBeHidden();
  await expect(page.locator(".ops-routes-map-canvas")).toHaveCount(0);
});

test("copiar link de acompanhamento do pedido, no painel e na tela de rotas", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openPanel(page);
  const tab = page.getByRole("tab", { name: /^Pedidos/ });
  if (await tab.isVisible()) await tab.click();
  const copy = page.getByRole("button", { name: "Copiar link de acompanhamento do pedido 2003" });
  await copy.click();
  await expect(copy).toHaveText("Link copiado ✓");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL(`/acompanhar/${token(3)}`, baseURL).toString());
  // On the street: the next stop's link, from "Acompanhar rotas". A delivered stop needs none.
  await page.getByRole("button", { name: "Acompanhar rotas" }).click();
  const tracker = page.getByRole("dialog", { name: "Acompanhar rotas" });
  await tracker.getByRole("button", { name: "Copiar link de acompanhamento do pedido 2002" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/acompanhar/${token(2)}`);
  await expect(tracker.getByRole("button", { name: "Copiar link de acompanhamento do pedido 2001" })).toHaveCount(0);
});
