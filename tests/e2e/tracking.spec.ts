import { test, expect, type Page } from "@playwright/test";

const token = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const started = "2026-11-13T22:40:00Z";
const states = {
  onRoute: { status: "ON_ROUTE", restaurantName: "Cozinha da Vila", issueReason: null, stopsBefore: 2,
    courier: null, destination: null, startedAt: started, deliveredAt: null },
  next: { status: "NEXT", restaurantName: "Cozinha da Vila", issueReason: null, stopsBefore: 0,
    courier: { latitude: -23.551, longitude: -46.633, recordedAt: "2026-11-13T22:52:00Z" },
    destination: { latitude: -23.556, longitude: -46.64 }, startedAt: started, deliveredAt: null },
  delivered: { status: "DELIVERED", restaurantName: "Cozinha da Vila", issueReason: null, stopsBefore: null,
    courier: null, destination: null, startedAt: started, deliveredAt: "2026-11-13T22:58:00Z" },
};
const notFound = { code: "P0002", message: "RPM_TRACKING_NOT_FOUND", details: null, hint: null };

type Reply = { status?: number; body: unknown } | "abort";

async function mockTracking(page: Page, first: Reply) {
  let reply = first;
  const calls: unknown[] = [];
  const mapRequests: { url: string; referer?: string }[] = [];
  await page.route("**/rest/v1/rpc/get_tracking", async route => {
    calls.push(route.request().postDataJSON());
    if (reply === "abort") return route.abort("internetdisconnected");
    await route.fulfill({ status: reply.status ?? 200, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  // Diagnostic-only image fixture; no real Mapbox request or public token.
  await page.route("https://api.mapbox.com/**", route => {
    mapRequests.push({ url: route.request().url(), referer: route.request().headers().referer });
    return route.fulfill({ contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#ecf1e7"/><path d="M0 160H640M300 0V320" stroke="#cbd2c8" stroke-width="24"/><text x="8" y="310" font-size="12">Mapa simulado para testes</text></svg>' });
  });
  return { calls, mapRequests, set: (next: Reply) => { reply = next; } };
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    // Expected failed RPC responses are logged by the browser as resource errors.
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
  });
  return errors;
}

test("cliente acompanha a caminho → próximo com mapa → entregue, e a página para de consultar", async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.install();
  const mock = await mockTracking(page, { body: states.onRoute });
  await page.goto(`/acompanhar/${token.toUpperCase()}`);

  await expect(page.getByRole("heading", { name: "Seu pedido está a caminho" })).toBeVisible();
  await expect(page.getByText("Pedido de Cozinha da Vila")).toBeVisible();
  await expect(page.getByText("2 entregas antes da sua", { exact: true })).toBeVisible();
  const steps = page.getByRole("list", { name: "Etapas da entrega" });
  await expect(steps.getByRole("listitem")).toHaveCount(4);
  await expect(steps.locator("[aria-current=step]")).toContainText("Em rota");
  await expect(page.getByRole("img")).toHaveCount(0);
  expect(mock.calls).toEqual([{ p_token: token }]);

  mock.set({ body: states.next });
  await page.clock.runFor(15_000);
  await expect(page.getByRole("heading", { name: "Você é o próximo!" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Mapa com o entregador e o seu endereço" })).toBeVisible();
  await expect(page.getByText(/Posição do entregador às \d{2}:\d{2}/)).toBeVisible();
  await expect(steps.locator("[aria-current=step]")).toContainText("Você é o próximo");
  await expect(page.getByText("2 entregas antes da sua")).toHaveCount(0);
  expect(mock.mapRequests.length).toBeGreaterThan(0);
  for (const request of mock.mapRequests) {
    expect(request.referer ?? "").not.toContain(token);
    expect(request.url).toContain("pin-l-scooter");
  }

  mock.set({ body: states.delivered });
  await page.clock.runFor(15_000);
  await expect(page.getByRole("heading", { name: "Pedido entregue" })).toBeVisible();
  await expect(page.getByText("Acompanhamento encerrado.")).toBeVisible();
  await expect(steps.locator("[aria-current=step]")).toHaveCount(0);
  const finished = mock.calls.length;
  await page.clock.runFor(120_000);
  expect(mock.calls.length).toBe(finished);
  expect(errors).toEqual([]);
});

test("link desconhecido ou malformado mostra não encontrado", async ({ page }) => {
  const mock = await mockTracking(page, { status: 404, body: notFound });
  await page.goto(`/acompanhar/${token}`);
  await expect(page.getByRole("heading", { name: "Link não encontrado" })).toBeVisible();
  expect(mock.calls).toHaveLength(1);

  await page.goto("/acompanhar/nao-e-um-token");
  await expect(page.getByRole("heading", { name: "Link não encontrado" })).toBeVisible();
  expect(mock.calls).toHaveLength(1);
});

test("falha na primeira leitura permite tentar de novo; queda depois mantém o último status", async ({ page }) => {
  await page.clock.install();
  const mock = await mockTracking(page, "abort");
  await page.goto(`/acompanhar/${token}`);
  await expect(page.getByRole("heading", { name: "Não foi possível carregar" })).toBeVisible();

  mock.set({ body: states.onRoute });
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("heading", { name: "Seu pedido está a caminho" })).toBeVisible();

  mock.set("abort");
  await page.clock.runFor(15_000);
  await expect(page.getByText("Sem conexão. Tentando atualizar…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Seu pedido está a caminho" })).toBeVisible();

  mock.set({ body: states.next });
  await page.clock.runFor(15_000);
  await expect(page.getByRole("heading", { name: "Você é o próximo!" })).toBeVisible();
  await expect(page.getByText("Sem conexão. Tentando atualizar…")).toHaveCount(0);
});

test("ocorrência e nome longo de loja cabem em 320/375/390 sem rolagem lateral", async ({ page }) => {
  await mockTracking(page, { body: { ...states.onRoute, status: "ATTEMPT_FAILED", issueReason: "CUSTOMER_NOT_RESPONDING",
    stopsBefore: null, restaurantName: "Restaurante e Pizzaria Sabor da Vila Mariana Delivery Expresso 24 Horas" } });
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/acompanhar/${token}`);
    await expect(page.getByRole("heading", { name: "Não conseguimos entregar" })).toBeVisible();
    await expect(page.getByText(/ninguém atendeu\. Restaurante e Pizzaria .+ vai decidir o próximo passo\./)).toBeVisible();
    await expect(page.getByRole("list", { name: "Etapas da entrega" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
