import { test, expect, type Page } from "@playwright/test";
import { mockSupabase, testRestaurant } from "./support/supabase";
import { storeBackend } from "./support/store-backend";
import { mockGeocoding, resolvedAddress } from "./support/geocoding";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill("operador@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("Test-only-password-123!");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function openPanel(page: Page) {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Central de operações" })).toBeVisible();
}

/** On phones each area is a tab; on desktop all are visible. */
async function showArea(page: Page, name: RegExp) {
  const tab = page.getByRole("tab", { name });
  if (await tab.isVisible()) await tab.click();
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    // Refused commands and dropped reads are logged by the browser as resource errors.
    if (message.type() === "error" && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(message.text()))
      errors.push(message.text());
  });
  return errors;
}

test("painel real: aprova turno, cadastra pedido, monta e libera rota pelo banco", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  const calls = await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);
  await expect(page.getByText("Demonstração com dados fictícios.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Montagem automática" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Selecionar pedido 1048", exact: true })).toBeVisible();
  expect(backend.calls[0]).toEqual({ fn: "get_operations_board", body: { p_restaurant_id: testRestaurant.id } });

  // A courier arrived and asked for a shift; on phones the Motoboys tab says so.
  const couriersTab = page.getByRole("tab", { name: /^Motoboys/ });
  const phone = await couriersTab.isVisible();
  if (phone) await expect(couriersTab).toHaveAccessibleName("Motoboys 1 turno pendente");
  await showArea(page, /^Motoboys/);
  const approve = page.getByRole("button", { name: "Aprovar turno de Carla Dias" });
  expect((await approve.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await approve.click();
  await expect(page.getByRole("status").filter({ hasText: "Turno de Carla Dias aprovado." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar turno de Carla Dias" })).toHaveCount(0);
  if (phone) await expect(couriersTab).toHaveAccessibleName("Motoboys");

  // New order, saved with the normalized phone and a request id.
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.locator("dialog[open]");
  await expect(form).toContainText("O cliente recebe o link de acompanhamento quando a rota sair.");
  await form.locator('input[name="customer"]').fill("Marina Teixeira");
  await form.locator('input[name="phone"]').fill("(11) 91234-5678");
  await form.locator('input[name="address"]').fill("Rua das Acácias, 55");
  await form.locator('input[name="neighborhood"]').fill("Vila Mariana");
  await form.locator('input[name="reference"]').fill("2001");
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toHaveCount(0);
  await showArea(page, /^Pedidos/);
  await expect(page.getByRole("checkbox", { name: "Selecionar pedido 2001", exact: true })).toBeVisible();
  const created = backend.commandCalls().find(call => call.fn === "create_order")!.body;
  expect(created).toMatchObject({ p_restaurant_id: testRestaurant.id, p_customer_name: "Marina Teixeira",
    p_customer_phone: "+5511912345678", p_delivery_address: "Rua das Acácias, 55", p_neighborhood: "Vila Mariana",
    p_reference: "2001", p_promised_minutes: 60 });
  expect(created.p_request_id).toMatch(UUID);
  // Typed text only (the search was not used): saved without coordinates.
  expect(created.p_latitude).toBeUndefined();

  // Route with two waiting orders for the first courier in line (Bruno, waiting longest after Dani's route).
  await page.getByRole("checkbox", { name: "Selecionar pedido 1048", exact: true }).check();
  await page.getByRole("checkbox", { name: "Selecionar pedido 2001", exact: true }).check();
  await showArea(page, /^Montagem/);
  await expect(page.getByRole("button", { name: "Sugerir sequência" })).toHaveCount(0);
  await page.getByRole("button", { name: "Atribuir rota", exact: false }).click();
  const route8 = page.locator("#ops-route-r-8");
  await expect(route8).toBeVisible();
  await expect(route8).toContainText("Bruno Alves");
  expect(backend.commandCalls().find(call => call.fn === "create_route")!.body).toMatchObject({
    p_restaurant_id: testRestaurant.id, p_shift_id: "s-bruno", p_delivery_ids: ["d-1048", "d-2001"] });
  await expect(route8.getByRole("button", { name: "Visão do motoboy (demo)" })).toHaveCount(0);

  await route8.getByRole("button", { name: "Liberar retirada" }).click();
  await expect(route8.getByRole("button", { name: "Cancelar liberação" })).toBeVisible();
  expect(backend.commandCalls().at(-1)).toEqual({ fn: "release_route_pickup",
    body: { p_restaurant_id: testRestaurant.id, p_route_id: "r-8", p_expected_version: 1 } });

  expect(calls.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test("ocorrência decidida pela Central e rota mudada em outro aparelho", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);

  await showArea(page, /^Rotas/);
  await page.locator("#ops-route-r-7").getByRole("button", { name: "! Decisão pendente" }).click();
  const center = page.getByRole("dialog", { name: "Central de ocorrências" });
  await expect(center).toBeVisible();
  await expect(center.getByText("Demonstração em memória.", { exact: false })).toHaveCount(0);
  await expect(center.getByText("Toquei três vezes")).toBeVisible();
  await center.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(center.getByText("Nenhuma ocorrência pendente. A operação pode seguir.")).toBeVisible();
  expect(backend.commandCalls().at(-1)).toEqual({ fn: "decide_delivery_failure",
    body: { p_restaurant_id: testRestaurant.id, p_delivery_id: "d-1050", p_decision: "RETRY" } });
  await center.getByRole("button", { name: "Fechar Central de ocorrências" }).click();

  // Someone changed R-6 on another device: the panel says so and reloads.
  backend.failOnce("release_route_pickup", { status: 400, json: { code: "P0001", message: "RPM_ROUTE_STALE" } });
  const reads = backend.boardReads();
  await page.locator("#ops-route-r-6").getByRole("button", { name: "Liberar retirada" }).click();
  await expect(page.getByRole("status").filter({ hasText: "A rota mudou em outro aparelho" })).toBeVisible();
  expect(backend.boardReads()).toBeGreaterThan(reads);
  await expect(page.locator("#ops-route-r-6").getByRole("button", { name: "Liberar retirada" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("sem conexão: primeira leitura permite tentar de novo e queda depois mantém o painel", async ({ page }) => {
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  backend.setOffline(true);
  await signIn(page);
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível carregar a operação." })).toBeVisible();
  // The store can still see which account is signed in and leave.
  await expect(page.getByText(testRestaurant.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();

  backend.setOffline(false);
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("heading", { name: "Central de operações" })).toBeVisible();

  // The panel reads again every 5 s; a drop keeps the last board on screen.
  backend.setOffline(true);
  await expect(page.getByText("Sem conexão.", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("checkbox", { name: "Selecionar pedido 1048", exact: true })).toBeVisible();

  // The courier finished a stop meanwhile; the next read shows it.
  backend.board.orders.find(item => item.deliveryId === "d-1051")!.deliveryStatus = "DELIVERED";
  backend.setOffline(false);
  await expect(page.getByText("Sem conexão.", { exact: true })).toHaveCount(0, { timeout: 8_000 });
  await showArea(page, /^Rotas/);
  await expect(page.locator('#ops-route-r-7 li[data-delivery="DELIVERED"]')).toHaveCount(1);
});

test("cancelar pedido e rota em preparação pedem confirmação; pedido devolvido volta à fila", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  // Brought back on a route already closed, and one still on the street (decided RETURN).
  backend.board.orders.push({ ...backend.board.orders[0], deliveryId: "d-1046", orderId: "o-1046", reference: "1046",
    customer: "Nina Prado", deliveryStatus: "RETURN_TO_STORE", orderStatus: "DELIVERING", failedAttempts: 1 });
  backend.board.orders.find(item => item.deliveryId === "d-1050")!.deliveryStatus = "RETURN_TO_STORE";
  backend.board.issues[0].decision = "RETURN";
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);
  await showArea(page, /^Pedidos/);

  // Cancel a waiting order: "Voltar" keeps it.
  await page.getByRole("button", { name: "Cancelar pedido 1049" }).click();
  const confirm = page.getByRole("dialog", { name: "Cancelar o pedido #1049?" });
  await expect(confirm).toContainText("Igor Nunes sai da fila de despacho.");
  await confirm.getByRole("button", { name: "Voltar" }).click();
  expect(backend.commandCalls().some(call => call.fn === "cancel_order")).toBe(false);
  await page.getByRole("button", { name: "Cancelar pedido 1049" }).click();
  await confirm.getByRole("button", { name: "Cancelar pedido" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pedido #1049 cancelado." })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Selecionar pedido 1049", exact: true })).toHaveCount(0);
  expect(backend.commandCalls().find(call => call.fn === "cancel_order")!.body).toEqual({
    p_restaurant_id: testRestaurant.id, p_order_id: "o-1049" });

  // Brought back: the closed route's order goes back to the queue; the one still on the street waits.
  const returned = page.getByRole("region", { name: /Voltaram para a loja/ });
  await expect(returned).toContainText("Volta com o motoboy");
  await returned.getByRole("button", { name: "Devolver pedido 1046 à fila" }).click();
  await expect(page.getByRole("checkbox", { name: "Selecionar pedido 1046", exact: true })).toBeVisible();
  expect(backend.commandCalls().find(call => call.fn === "requeue_delivery")!.body).toEqual({
    p_restaurant_id: testRestaurant.id, p_delivery_id: "d-1046" });

  // Cancel a route still in preparation: its order waits again.
  await showArea(page, /^Rotas/);
  await page.locator("#ops-route-r-6").getByRole("button", { name: "Cancelar rota R-6" }).click();
  await page.getByRole("dialog", { name: "Cancelar a rota R-6?" }).getByRole("button", { name: "Cancelar rota" }).click();
  await expect(page.locator("#ops-route-r-6")).toHaveCount(0);
  expect(backend.commandCalls().find(call => call.fn === "cancel_route")!.body).toEqual({
    p_restaurant_id: testRestaurant.id, p_route_id: "r-6" });
  await showArea(page, /^Pedidos/);
  await expect(page.getByRole("checkbox", { name: "Selecionar pedido 1047", exact: true })).toBeVisible();
  // On the street, no "simulação" label on real routes.
  await showArea(page, /^Rotas/);
  await expect(page.getByText(/— simulação/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("novo pedido: endereço escolhido na busca vai com a localização para o mapa do cliente", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  const geocoding = await mockGeocoding(page);
  await openPanel(page);
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.locator("dialog[open]");
  await expect(form).toContainText("Sem escolher, o pedido é salvo só com o texto.");
  await form.locator('input[name="customer"]').fill("Marina Teixeira");
  await form.locator('input[name="phone"]').fill("(11) 91234-5678");
  await form.getByRole("combobox", { name: "Endereço" }).fill("Rua das Flores, 120");
  await form.getByRole("option", { name: "Rua das Flores, 120 São Paulo, Brasil" }).click();
  await expect(form.getByText("✓ Endereço confirmado", { exact: true })).toBeVisible();
  await expect(form).toContainText("o cliente vê a casa no mapa");
  await expect(form.getByRole("img", { name: "Mapa do endereço do cliente, com marcador" })).toBeVisible();
  await form.locator('input[name="neighborhood"]').fill("Vila Mariana");
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toHaveCount(0);
  expect(geocoding.resolve).toEqual([resolvedAddress.providerId]);
  expect(backend.commandCalls().find(call => call.fn === "create_order")!.body).toMatchObject({
    p_delivery_address: resolvedAddress.address, p_latitude: resolvedAddress.latitude, p_longitude: resolvedAddress.longitude,
    p_address_provider: "mapbox", p_address_provider_id: resolvedAddress.providerId });

  // The next order starts with an empty address search.
  await page.getByRole("button", { name: "Novo pedido" }).click();
  await expect(page.locator("dialog[open]").getByRole("combobox", { name: "Endereço" })).toHaveValue("");
  await expect(page.locator("dialog[open]").getByText("✓ Endereço confirmado", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("pagamento dos motoboys: valores da loja e acerto do dia", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);
  await showArea(page, /^Motoboys/);
  await page.getByRole("button", { name: "Pagamento dos motoboys" }).click();
  const dialog = page.getByRole("dialog", { name: "Pagamento dos motoboys" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("row", { name: /Ana Souza/ })).toContainText("R$ 51,00");
  await expect(dialog.getByRole("row", { name: /Total do dia/ })).toContainText("R$ 88,00");
  expect(backend.commandCalls().at(-1)).toMatchObject({ fn: "get_courier_pay", body: { p_restaurant_id: testRestaurant.id } });

  // Long names wrap inside the dialog, never widening the page.
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]);

  const encosta = dialog.getByLabel("Taxa de encosta (por dia)");
  await expect(encosta).toHaveValue("30,00");
  await encosta.fill("abc");
  await dialog.getByRole("button", { name: "Salvar valores" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Informe valores de R$ 0 a R$ 1.000");
  await encosta.fill("35");
  await dialog.getByLabel("Valor por entrega").fill("7,50");
  await dialog.getByRole("button", { name: "Salvar valores" }).click();
  await expect(dialog.getByRole("status")).toContainText("Valores salvos");
  expect(backend.commandCalls().find(call => call.fn === "set_courier_pay")!.body).toEqual({
    p_restaurant_id: testRestaurant.id, p_shift_fee_cents: 3500, p_delivery_fee_cents: 750 });
  await expect(encosta).toHaveValue("35,00");
  await dialog.getByRole("button", { name: "Fechar pagamento dos motoboys" }).click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test("pagamento dos motoboys: operador vê o acerto sem alterar valores", async ({ page }) => {
  const backend = storeBackend();
  backend.pay.canEdit = false;
  backend.pay.couriers = [];
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);
  await showArea(page, /^Motoboys/);
  await page.getByRole("button", { name: "Pagamento dos motoboys" }).click();
  const dialog = page.getByRole("dialog", { name: "Pagamento dos motoboys" });
  await expect(dialog.getByText("Nenhum motoboy trabalhou neste dia.")).toBeVisible();
  await expect(dialog.getByText("Só o dono ou o gerente da loja altera estes valores.")).toBeVisible();
  await expect(dialog.getByLabel("Taxa de encosta (por dia)")).toHaveAttribute("readonly", "");
  await expect(dialog.getByRole("button", { name: "Salvar valores" })).toHaveCount(0);
});
