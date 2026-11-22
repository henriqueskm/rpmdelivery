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
/** /^Rotas/ opens "Acompanhar rotas" (a modal, where routes live); any other area closes it and picks the column. */
async function showArea(page: Page, name: RegExp) {
  const tracker = page.getByRole("dialog", { name: "Acompanhar rotas" });
  if (name.source === "^Rotas") {
    if (!(await tracker.isVisible())) await page.locator(".ops-follow-routes").click();
    await expect(tracker).toBeVisible();
    return;
  }
  if (await tracker.isVisible()) await page.keyboard.press("Escape");
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
  // The new route waits for its release: the banner opens "Acompanhar rotas" on it.
  await expect(page.getByRole("region", { name: "Retiradas para liberar" })).toContainText("R-8 · Bruno Alves");
  await page.getByRole("button", { name: "Abrir e liberar" }).click();
  const route8 = page.locator("#ops-route-r-8");
  await expect(route8).toBeFocused();
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
  await page.locator("#ops-route-r-7").getByRole("button", { name: "Decidir ocorrência #1050" }).click();
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
  await showArea(page, /^Rotas/);
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
  await page.getByRole("button", { name: `${testRestaurant.name}, abrir menu` }).click();
  const menu = page.getByRole("dialog", { name: "Menu da loja" });
  await expect(menu.getByText("operador@example.test")).toBeVisible();
  await expect(menu.getByRole("button", { name: "Sair", exact: true })).toBeVisible();
  // Before the board loads there is nothing to pay yet.
  await expect(menu.getByRole("button", { name: "Pagamentos dos motoboys" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

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

  // Cancel a waiting order (from its "⋯" menu): "Voltar" keeps it.
  await page.getByLabel("Ações do pedido 1049").click();
  await page.getByRole("button", { name: "Cancelar pedido 1049" }).click();
  const confirm = page.getByRole("dialog", { name: "Cancelar o pedido #1049?" });
  await expect(confirm).toContainText("Igor Nunes sai da fila de despacho.");
  await confirm.getByRole("button", { name: "Voltar" }).click();
  expect(backend.commandCalls().some(call => call.fn === "cancel_order")).toBe(false);
  await page.getByLabel("Ações do pedido 1049").click();
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
  const geocoding = await mockGeocoding(page, { street: true, neighborhood: "Vila Mariana" });
  await openPanel(page);
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.locator("dialog[open]");
  await expect(form).toContainText("Sem escolher, o pedido é salvo só com o texto.");
  await form.locator('input[name="customer"]').fill("Marina Teixeira");
  await form.locator('input[name="phone"]').fill("(11) 91234-5678");
  // Just the street name is enough to start; picking the street asks for the number.
  const address = form.getByRole("combobox", { name: "Endereço" });
  await address.fill("Rua das Fl");
  await form.getByRole("option", { name: "Rua das Flores São Paulo, Brasil" }).click();
  await expect(address).toHaveValue("Rua das Flores, ");
  await expect(address).toBeFocused();
  await expect(form).toContainText("Agora digite o número");
  expect(geocoding.resolve).toEqual([]);
  await address.press("End");
  await address.pressSequentially("120");
  await form.getByRole("option", { name: "Rua das Flores, 120 São Paulo, Brasil" }).click();
  await expect(form.getByText("✓ Endereço confirmado", { exact: true })).toBeVisible();
  await expect(form).toContainText("o cliente vê a casa no mapa");
  await expect(form.getByRole("img", { name: "Mapa do endereço do cliente, com marcador" })).toBeVisible();
  // The bairro comes with the address; the order number is its own, optional field.
  await expect(form.locator('input[name="neighborhood"]')).toHaveValue("Vila Mariana");
  await form.getByLabel("Nº do pedido (opcional)").fill("329");
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toHaveCount(0);
  expect(geocoding.resolve).toEqual([resolvedAddress.providerId]);
  expect(backend.commandCalls().find(call => call.fn === "create_order")!.body).toMatchObject({
    p_delivery_address: resolvedAddress.address, p_latitude: resolvedAddress.latitude, p_longitude: resolvedAddress.longitude,
    p_address_provider: "mapbox", p_address_provider_id: resolvedAddress.providerId, p_neighborhood: "Vila Mariana" });

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
  // "Convites e vínculos" and "Pagamentos" sit on one line.
  const invites = (await page.getByRole("link", { name: "Convites e vínculos" }).boundingBox())!;
  const payButton = (await page.getByRole("button", { name: "Pagamentos", exact: true }).boundingBox())!;
  expect(Math.abs(invites.y + invites.height / 2 - (payButton.y + payButton.height / 2))).toBeLessThan(2);
  await page.getByRole("button", { name: "Pagamentos", exact: true }).click();
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

test("sugerir rotas: junta pela rua e pelo caminho, explica o motivo e preenche a montagem", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  // The store and three waiting orders with a confirmed pin; 1048 and 1049 have none.
  Object.assign(backend.board, { storeLocation: { latitude: -23.0, longitude: -46.8 } });
  const pinned = (reference: string, customer: string, address: string, neighborhood: string, latitude: number, longitude: number) => ({
    ...structuredClone(backend.board.orders[0]), deliveryId: `d-${reference}`, orderId: `o-${reference}`, reference, customer,
    address, neighborhood, latitude, longitude });
  backend.board.orders.push(
    // 2.5 km south: the same street twice, and 2.2 km further down the same way a third bairro.
    pinned("2101", "Paula Rocha", "Rua das Acácias, 55", "Centro", -23.0225, -46.8),
    pinned("2102", "Rui Campos", "R. das Acacias, 140", "Centro", -23.0233, -46.8003),
    pinned("2103", "Sara Lopes", "Rua Sul, 1", "Jardim Sul", -23.045, -46.8),
    // The other way round, 8 km west: never "on the way" of the others.
    pinned("2104", "Tito Alves", "Estrada Oeste, 900", "Chácaras", -23.0, -46.88));
  const calls = await mockSupabase(page, { existing: true, rpc: backend.handlers });
  // The street times are down: the suggestions fall back to the estimate and say so.
  const legRequests: unknown[] = [];
  await page.route("**/api/routing/legs", route => {
    legRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { message: "Tempos pelas ruas indisponíveis no momento." } });
  });
  await openPanel(page);
  await showArea(page, /^Montagem/);
  await page.getByRole("button", { name: "Sugerir rotas" }).click();
  const dialog = page.getByRole("dialog", { name: "Sugestões de rota" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Sem os tempos das ruas agora: tempos estimados pela distância.");
  await expect(dialog).toContainText("de bairros vizinhos (até 2 km)");
  await expect(dialog.getByRole("link", { name: "Ajustar limites em Dados da loja" })).toHaveAttribute("href", "/loja");
  // The store first, then the pinned waiting orders, most urgent first.
  expect(legRequests[0]).toMatchObject({ restaurantId: testRestaurant.id });
  expect((legRequests[0] as { points: unknown[] }).points[0]).toEqual({ latitude: -23.0, longitude: -46.8 });
  expect((legRequests[0] as { points: unknown[] }).points).toHaveLength(5);

  const first = dialog.getByRole("listitem", { name: "Rota sugerida 1" });
  await expect(first).toContainText("3 entregas");
  await expect(first).toContainText("Motoboy: Bruno Alves · próximo da fila");
  const stops = first.locator(".ops-suggestion-stops > li");
  await expect(stops.nth(0)).toContainText("#2101 Paula Rocha");
  await expect(stops.nth(0)).toContainText("Pedido base da rota");
  await expect(stops.nth(1)).toContainText("#2102 Rui Campos");
  await expect(stops.nth(1)).toContainText("Mesma rua de #2101");
  // Further down the same way: on the way, at almost no extra riding.
  await expect(stops.nth(2)).toContainText("#2103 Sara Lopes");
  await expect(stops.nth(2)).toContainText(/No caminho de #210[12]/);
  const second = dialog.getByRole("listitem", { name: "Rota sugerida 2" });
  await expect(second).toContainText("#2104 Tito Alves");
  await expect(second).toContainText("Sem motoboy disponível agora");
  await expect(dialog).toContainText("2 pedidos ficaram de fora por não ter o endereço confirmado no mapa: #1048, #1049.");
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]);

  // The suggestion only fills the Montagem; the store assigns as usual.
  await first.getByRole("button", { name: "Usar esta rota na montagem" }).click();
  await expect(dialog).toBeHidden();
  const sequence = page.getByLabel("Sequência planejada").locator(".ops-sequence > li");
  await expect(sequence).toHaveCount(3);
  await expect(sequence.nth(0)).toContainText("#2101 · Paula Rocha");
  await expect(sequence.nth(1)).toContainText("#2102 · Rui Campos");
  await expect(sequence.nth(2)).toContainText("#2103 · Sara Lopes");
  expect(backend.commandCalls().some(call => call.fn === "create_route")).toBe(false);
  await page.getByRole("button", { name: "Atribuir rota", exact: false }).click();
  await expect.poll(() => backend.commandCalls().find(call => call.fn === "create_route")?.body).toMatchObject({
    p_restaurant_id: testRestaurant.id, p_shift_id: "s-bruno", p_delivery_ids: ["d-2101", "d-2102", "d-2103"] });
  expect(calls.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test("sugerir rotas com os tempos das ruas e os limites da loja", async ({ page }) => {
  const backend = storeBackend();
  Object.assign(backend.board, { storeLocation: { latitude: -23.0, longitude: -46.8 } });
  const pinned = (reference: string, customer: string, address: string, neighborhood: string, latitude: number, longitude: number) => ({
    ...structuredClone(backend.board.orders[0]), deliveryId: `d-${reference}`, orderId: `o-${reference}`, reference, customer,
    address, neighborhood, latitude, longitude });
  // 1.3 km apart, neighbors by the estimate; on the streets a river puts them 25 min apart, the other way round.
  backend.board.orders.push(
    pinned("3101", "Ana Beira", "Rua Um, 1", "Centro", -23.01, -46.8),
    pinned("3102", "Beto Ponte", "Rua Dois, 2", "Outro Lado", -23.01, -46.787));
  // The store limits suggestions to 2 per route (owner).
  backend.handlers.get_route_settings = () => ({ json: { maxStops: 2, maxDetourMinutes: 5, neighborMeters: 1500, canEdit: true } });
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await page.route("**/api/routing/legs", route => route.fulfill({ json: { partial: false, fetched: 6,
    durations: [[0, 200, 600], [200, 0, 1800], [600, 1800, 0]],
    distances: [[0, 1400, 4000], [1400, 0, 12000], [4000, 12000, 0]] } }));
  await openPanel(page);
  await showArea(page, /^Montagem/);
  await page.getByRole("button", { name: "Sugerir rotas" }).click();
  const dialog = page.getByRole("dialog", { name: "Sugestões de rota" });
  await expect(dialog).toContainText("Tempos pelas ruas, sem trânsito.");
  await expect(dialog).toContainText("de bairros vizinhos (até 1,5 km) e os que ficam no caminho (até 5 min a mais)");
  await expect(dialog).toContainText("com até 2 entregas por rota");
  // Separated by the street times; each alone.
  await expect(dialog.getByRole("listitem", { name: "Rota sugerida 1" })).toContainText("1 entrega");
  await expect(dialog.getByRole("listitem", { name: "Rota sugerida 2" })).toContainText("1 entrega");
});

test("sugerir rotas sem o endereço da loja no mapa explica o que falta", async ({ page }) => {
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);
  await showArea(page, /^Montagem/);
  await page.getByRole("button", { name: "Sugerir rotas" }).click();
  await expect(page.getByRole("dialog", { name: "Sugestões de rota" }).getByRole("status"))
    .toContainText("a loja precisa do endereço confirmado no mapa");
});

test("ficha do motoboy: clicar no nome mostra foto, contato, moto e números do dia", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  const calls = await mockSupabase(page, { existing: true, rpc: backend.handlers });
  // The photo lives in a private bucket: the panel asks for a short signed link, then loads it.
  const storage: string[] = [];
  await page.route("http://127.0.0.1:54321/storage/v1/object/**", async route => {
    const url = new URL(route.request().url());
    storage.push(`${route.request().method()} ${url.pathname}`);
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
    if (url.pathname.startsWith("/storage/v1/object/sign/") && route.request().method() === "POST")
      return route.fulfill({ headers: { "access-control-allow-origin": "*" },
        json: { signedURL: "/object/sign/courier-photos/u-ana/avatar.jpg?token=e2e-signed" } });
    return route.fulfill({ path: "public/courier/mascot-256.webp", contentType: "image/webp",
      headers: { "access-control-allow-origin": "*" } });
  });
  await openPanel(page);
  await showArea(page, /^Motoboys/);

  await page.getByRole("button", { name: "Abrir ficha de Ana Souza" }).click();
  const card = page.getByRole("dialog", { name: "Ana Souza" });
  await expect(card).toBeVisible();
  expect(backend.commandCalls().at(-1)).toEqual({ fn: "get_courier_card", body: { p_shift_id: "s-ana" } });
  const photo = card.getByRole("img", { name: "Foto de Ana Souza" });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(storage).toContain("POST /storage/v1/object/sign/courier-photos/u-ana/avatar.jpg");
  await expect(card.getByRole("link", { name: "(11) 98765-0011" })).toHaveAttribute("href", "tel:+5511987650011");
  await expect(card).toContainText("Honda CG 160 · Vermelha");
  await expect(card).toContainText("ABC1D23");
  await expect(card.getByRole("definition").filter({ hasText: "desde" })).toHaveText("Ativo desde 02/11/2026");
  await expect(card).toContainText("Em rota");
  await expect(card).toContainText("há 3 min");
  const numbers = card.getByLabel("Números nesta loja");
  await expect(numbers).toContainText("3entregas hoje");
  await expect(numbers).toContainText("R$ 51,00a receber hoje");
  await expect(numbers).toContainText("42entregas nesta loja");
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]);
  await card.getByRole("button", { name: "Fechar ficha de Ana Souza" }).click();
  await expect(card).toBeHidden();

  // Without a photo or registration: initials and plain words, never a broken image.
  await page.getByRole("button", { name: "Abrir ficha de Bruno Alves" }).click();
  const bruno = page.getByRole("dialog", { name: "Bruno Alves" });
  await expect(bruno).toContainText("Sem foto. O motoboy adiciona em Meu cadastro, no app.");
  await expect(bruno.locator(".ops-courier-photo")).toHaveText("BA");
  await expect(bruno.getByRole("img")).toHaveCount(0);
  await expect(bruno).toContainText("Não informado");
  await expect(bruno).toContainText("Ainda não enviou");
  await page.keyboard.press("Escape");
  await expect(bruno).toBeHidden();

  // Gone from the shift meanwhile: the card says so.
  backend.failOnce("get_courier_card", { status: 404, json: { code: "P0002", message: "RPM_COURIER_NOT_FOUND" } });
  await page.getByRole("button", { name: "Abrir ficha de Dani Lima" }).click();
  await expect(page.getByRole("dialog", { name: "Dani Lima" }).getByRole("alert"))
    .toContainText("Esse motoboy não está mais no turno desta loja.");
  expect(calls.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test("pagamento dos motoboys: operador vê o acerto sem alterar valores", async ({ page }) => {
  const backend = storeBackend();
  backend.pay.canEdit = false;
  backend.pay.couriers = [];
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);
  await showArea(page, /^Motoboys/);
  await page.getByRole("button", { name: "Pagamentos", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pagamento dos motoboys" });
  await expect(dialog.getByText("Nenhum motoboy trabalhou neste dia.")).toBeVisible();
  await expect(dialog.getByText("Só o dono ou o gerente da loja altera estes valores.")).toBeVisible();
  await expect(dialog.getByLabel("Taxa de encosta (por dia)")).toHaveAttribute("readonly", "");
  await expect(dialog.getByRole("button", { name: "Salvar valores" })).toHaveCount(0);
});

test("acompanhar rotas: tela com cada rota na rua, entregas em ordem e ocorrência para decidir", async ({ page }) => {
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);
  await page.getByRole("button", { name: "Acompanhar rotas" }).click();
  const tracker = page.getByRole("dialog", { name: "Acompanhar rotas" });
  await expect(tracker).toBeVisible();
  await expect(tracker).toContainText("1 rota na rua · 1 aguardando retirada");
  const r7 = tracker.getByRole("article", { name: "Rota R-7", exact: true });
  await expect(r7).toContainText("Ana Souza");
  await expect(r7).toContainText("Saiu há 18 min · 0 de 2 entregues");
  const stops = r7.locator(".ops-tracker-stop");
  await expect(stops.nth(0)).toContainText("#1050 · Liberdade");
  await expect(stops.nth(0)).toContainText("Ocorrência");
  await expect(stops.nth(1)).toContainText("#1051 · Aclimação");
  await expect(stops.nth(1)).toContainText("Próxima");
  // The route waiting for the store comes first, with its release button.
  const r6 = tracker.getByRole("article", { name: "Rota R-6", exact: true });
  await expect(r6).toContainText("Dani Lima");
  await expect(r6.getByRole("button", { name: "Liberar retirada" })).toBeVisible();
  // Deciding the occurrence leaves this screen for the Central.
  await r7.getByRole("button", { name: "Decidir ocorrência #1050" }).click();
  await expect(tracker).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Central de ocorrências" })).toBeVisible();
});

test("novo pedido: trocar o endereço troca o bairro preenchido sozinho", async ({ page }) => {
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await mockGeocoding(page, { neighborhood: ["Vila Mariana", "Pinheiros", "", "Lapa"] });
  await openPanel(page);
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.locator("dialog[open]");
  const address = form.getByRole("combobox", { name: "Endereço" });
  const bairro = form.locator('input[name="neighborhood"]');
  const pick = async () => {
    await address.fill("Rua das Flores, 120");
    await form.getByRole("option", { name: "Rua das Flores, 120 São Paulo, Brasil" }).click();
    await expect(form.getByText("✓ Endereço confirmado", { exact: true })).toBeVisible();
  };
  await pick();
  await expect(bairro).toHaveValue("Vila Mariana");
  // Another address: its own bairro, not the previous street's.
  await pick();
  await expect(bairro).toHaveValue("Pinheiros");
  // An address whose bairro was not found clears the old one instead of keeping it.
  await pick();
  await expect(bairro).toHaveValue("");
  // A bairro typed by the store is never overwritten.
  await bairro.fill("Centro");
  await pick();
  await expect(bairro).toHaveValue("Centro");
});

test("editar pedido aguardando despacho: formulário preenchido, salva e mantém o ponto do mapa", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);
  await showArea(page, /^Pedidos/);
  await page.getByLabel("Ações do pedido 1049").click();
  await page.getByRole("button", { name: "Editar pedido 1049" }).click();
  const form = page.getByRole("dialog", { name: "Editar pedido #1049" });
  await expect(form.getByLabel("Nome do cliente")).toHaveValue("Igor Nunes");
  await expect(form.getByLabel("Endereço")).toHaveValue("Rua Sintética, 1049");
  await form.getByLabel("Nome do cliente").fill("Igor Nunes Filho");
  await form.getByLabel("Observações").fill("Interfone 12");
  await form.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Pedido #1049 atualizado." })).toBeVisible();
  await expect(page.locator(".ops-order").filter({ hasText: "#1049" })).toContainText("Igor Nunes Filho");
  const call = backend.commandCalls().find(item => item.fn === "update_order")!.body;
  expect(call).toMatchObject({ p_restaurant_id: testRestaurant.id, p_order_id: "o-1049", p_customer_name: "Igor Nunes Filho",
    p_notes: "Interfone 12", p_delivery_address: "Rua Sintética, 1049", p_keep_location: true });
  expect(call).not.toHaveProperty("p_latitude");
  // Orders already in a route have no edit or cancel, only the customer's link.
  await expect(page.getByRole("button", { name: /^Editar pedido 1047/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
