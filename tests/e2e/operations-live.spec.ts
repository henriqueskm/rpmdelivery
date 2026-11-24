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
  // The courier must know whether to collect: the payment is required, and a card needs the amount.
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toBeVisible();
  expect(await form.getByRole("radio", { name: "Já pago" }).evaluate(input => (input as HTMLInputElement).validity.valueMissing)).toBe(true);
  expect(backend.commandCalls().filter(call => call.fn === "create_order")).toHaveLength(0);
  await form.getByRole("radio", { name: "Cartão" }).check();
  await expect(form.getByText("O motoboy é avisado para levar a maquininha.")).toBeVisible();
  await expect(form.getByLabel("Troco para (R$, opcional)"), "change only for cash").toHaveCount(0);
  await form.getByLabel("Valor a cobrar (R$)").fill("45,9x");
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toBeVisible();
  expect(await form.getByLabel("Valor a cobrar (R$)").evaluate(input => (input as HTMLInputElement).validationMessage))
    .toBe("Informe o valor a cobrar do cliente, como 52,90.");
  await form.getByLabel("Valor a cobrar (R$)").fill("45,90");
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toHaveCount(0);
  await showArea(page, /^Pedidos/);
  await expect(page.getByRole("checkbox", { name: "Selecionar pedido 2001", exact: true })).toBeVisible();
  await expect(page.locator(".ops-order").filter({ hasText: "#2001" }).locator(".ops-order-payment"))
    .toContainText("Cobrar R$ 45,90 · cartão");
  const created = backend.commandCalls().find(call => call.fn === "create_order")!.body;
  expect(created).toMatchObject({ p_restaurant_id: testRestaurant.id, p_customer_name: "Marina Teixeira",
    p_customer_phone: "+5511912345678", p_delivery_address: "Rua das Acácias, 55", p_neighborhood: "Vila Mariana",
    p_reference: "2001", p_promised_minutes: 60, p_payment_method: "CARD", p_amount_due_cents: 4590, p_change_for_cents: null });
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
  await form.getByRole("radio", { name: "Já pago" }).check();
  await expect(form.getByLabel("Valor a cobrar (R$)"), "nothing to collect").toHaveCount(0);
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toHaveCount(0);
  expect(geocoding.resolve).toEqual([resolvedAddress.providerId]);
  expect(backend.commandCalls().find(call => call.fn === "create_order")!.body).toMatchObject({
    p_delivery_address: resolvedAddress.address, p_latitude: resolvedAddress.latitude, p_longitude: resolvedAddress.longitude,
    p_address_provider: "mapbox", p_address_provider_id: resolvedAddress.providerId, p_neighborhood: "Vila Mariana",
    p_payment_method: "PAID", p_amount_due_cents: null, p_change_for_cents: null });

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

test("pedido rápido: cliente que já pediu é reconhecido pelo WhatsApp e preenche o resto", async ({ page }) => {
  const backend = storeBackend();
  const lookups: unknown[] = [];
  backend.handlers.find_customer = body => {
    lookups.push(body);
    return { json: String(body.p_phone).replace(/\D/g, "") === "11977776666" ? {
      name: "Helena Prado", address: "Rua das Acácias, 55", neighborhood: "Bela Vista", complement: "Apto 12",
      location: { latitude: -23.58, longitude: -46.64, providerId: "mapbox_helena" }, orders: 3, lastOrderAt: new Date().toISOString(),
    } : null };
  };
  const calls = await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);
  await page.getByRole("button", { name: "Novo pedido" }).first().click();
  const form = page.locator("dialog[open]");
  const phone = form.getByLabel("WhatsApp", { exact: true });
  await expect(phone).toBeFocused();
  await phone.fill("(11) 97777-6666");
  const known = form.getByRole("status").filter({ hasText: "Já pediu aqui 3 vezes." });
  await expect(known).toContainText("Helena Prado · Rua das Acácias, 55 · Bela Vista");
  expect(lookups).toEqual([{ p_restaurant_id: testRestaurant.id, p_phone: "(11) 97777-6666" }]);
  await form.locator('input[name="reference"]').fill("3001");
  await known.getByRole("button", { name: "Usar estes dados" }).click();

  await expect(form.getByRole("status").filter({ hasText: "Dados de Helena Prado preenchidos." })).toBeVisible();
  await expect(form.getByLabel("Nome do cliente")).toHaveValue("Helena Prado");
  await expect(form.getByLabel("WhatsApp", { exact: true })).toHaveValue("(11) 97777-6666");
  await expect(form.getByRole("combobox", { name: "Endereço" })).toHaveValue("Rua das Acácias, 55");
  await expect(form.getByText("Localização confirmada: o cliente vê a casa no mapa.", { exact: false })).toBeVisible();
  await expect(form.getByLabel("Bairro")).toHaveValue("Bela Vista");
  await expect(form.getByLabel("Complemento / referência")).toHaveValue("Apto 12");
  await expect(form.locator('input[name="reference"]'), "what was typed stays").toHaveValue("3001");
  await form.getByRole("radio", { name: "Dinheiro" }).check();
  await form.getByLabel("Valor a cobrar (R$)").fill("38");
  await form.getByLabel("Troco para (R$, opcional)").fill("30");
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form, "change for a smaller bill is refused").toBeVisible();
  await form.getByLabel("Troco para (R$, opcional)").fill("50,00");
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toHaveCount(0);
  expect(backend.commandCalls().find(call => call.fn === "create_order")!.body).toMatchObject({
    p_customer_name: "Helena Prado", p_customer_phone: "+5511977776666", p_delivery_address: "Rua das Acácias, 55",
    p_neighborhood: "Bela Vista", p_complement: "Apto 12", p_reference: "3001",
    p_latitude: -23.58, p_longitude: -46.64, p_address_provider: "mapbox", p_address_provider_id: "mapbox_helena",
    p_payment_method: "CASH", p_amount_due_cents: 3800, p_change_for_cents: 5000 });

  // A number nobody used: no suggestion.
  await page.getByRole("button", { name: "Novo pedido" }).first().click();
  await form.getByLabel("WhatsApp", { exact: true }).fill("(11) 91111-2222");
  await expect.poll(() => lookups.length).toBe(2);
  await expect(form.getByText("Já pediu aqui")).toHaveCount(0);
  expect(calls.unexpected).toEqual([]);
});

test("pedido rápido: colar o texto do pedido preenche o formulário e já busca o endereço", async ({ page }) => {
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  const geocoding = await mockGeocoding(page);
  await openPanel(page);
  await page.getByRole("button", { name: "Novo pedido" }).first().click();
  const form = page.locator("dialog[open]");
  await form.locator('input[name="notes"], textarea[name="notes"]').fill("Troco para 100");
  await form.getByRole("button", { name: "Colar pedido (WhatsApp, app ou cupom)" }).click();
  await form.getByLabel("Cole o pedido aqui").fill("oi, quero 2 pizzas");
  await form.getByRole("button", { name: "Preencher com o texto" }).click();
  await expect(form.getByRole("alert")).toContainText("Não reconheci nome, WhatsApp nem endereço");

  await form.getByLabel("Cole o pedido aqui").fill(`*Pedido #4567*
Cliente: Maria da Silva
Telefone: (11) 98765-4321
Endereço: Rua das Flores, 120 - Apto 3
Bairro: Jardim Paulista
Total: R$ 52,90
Pagamento: Dinheiro
Troco para: R$ 100,00`);
  await form.getByRole("button", { name: "Preencher com o texto" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Preenchido: nome, WhatsApp, endereço, bairro, complemento e nº do pedido." }))
    .toContainText("Pagamento lido do texto: confira abaixo. Escolha o endereço na lista para confirmar no mapa.");
  await expect(form.getByRole("radio", { name: "Dinheiro" })).toBeChecked();
  await expect(form.getByLabel("Valor a cobrar (R$)")).toHaveValue("52,90");
  await expect(form.getByLabel("Troco para (R$, opcional)")).toHaveValue("100,00");
  await expect(form.getByLabel("WhatsApp", { exact: true })).toHaveValue("(11) 98765-4321");
  await expect(form.getByLabel("Nome do cliente")).toHaveValue("Maria da Silva");
  await expect(form.getByLabel("Bairro")).toHaveValue("Jardim Paulista");
  await expect(form.getByLabel("Complemento / referência")).toHaveValue("Apto 3");
  await expect(form.locator('input[name="reference"]')).toHaveValue("4567");
  await expect(form.locator('textarea[name="notes"]'), "what the text did not have stays").toHaveValue("Troco para 100");
  // The pasted address is searched right away: pick it to confirm the pin.
  await expect(form.getByRole("combobox", { name: "Endereço" })).toHaveValue("Rua das Flores, 120");
  await expect.poll(() => geocoding.suggest).toEqual(["Rua das Flores, 120"]);
  await form.getByRole("option", { name: /Rua das Flores, 120/ }).click();
  await expect(form.getByText("Localização confirmada", { exact: false })).toBeVisible();
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toHaveCount(0);
  expect(backend.commandCalls().find(call => call.fn === "create_order")!.body).toMatchObject({
    p_customer_name: "Maria da Silva", p_customer_phone: "+5511987654321", p_delivery_address: resolvedAddress.address,
    p_neighborhood: "Jardim Paulista", p_complement: "Apto 3", p_reference: "4567", p_notes: "Troco para 100",
    p_address_provider_id: resolvedAddress.providerId, p_payment_method: "CASH", p_amount_due_cents: 5290, p_change_for_cents: 10000 });
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
  // The store's history: Centro and Jardim Sul have centers 1.4 km apart, so they are neighbors.
  backend.handlers.get_neighborhood_centers = () => ({ json: [
    { neighborhood: "Centro", latitude: -23.0229, longitude: -46.8, orders: 10 },
    { neighborhood: "Jardim Sul", latitude: -23.0355, longitude: -46.8, orders: 4 } ] });
  const calls = await mockSupabase(page, { existing: true, rpc: backend.handlers });
  // The street times are down: the suggestions fall back to the estimate and say so.
  const legRequests: unknown[] = [];
  await page.route("**/api/routing/legs", route => {
    legRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { message: "Tempos pelas ruas indisponíveis no momento." } });
  });
  await openPanel(page);
  // Bruno is free and 4 orders wait with a pin: the panel offers the suggestions.
  const free = page.getByRole("region", { name: "Motoboy livre" });
  await expect(free).toContainText("Bruno Alves está livre");
  await expect(free).toContainText("4 pedidos esperando com endereço no mapa");
  await free.getByRole("button", { name: "Sugerir rotas" }).click();
  const dialog = page.getByRole("dialog", { name: "Sugestões de rota" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Sem os tempos das ruas agora: tempos estimados pela distância.");
  await expect(dialog).toContainText("de bairros vizinhos (até 1,5 km)");
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
  // Further down the same way, in a bairro the history says is next door.
  await expect(stops.nth(2)).toContainText("#2103 Sara Lopes");
  await expect(stops.nth(2)).toContainText(/Bairro vizinho de #210[12] \(centros a 1,4 km\)/);
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
  // "Agora não" hides the free-courier notice; the Montagem button still opens the suggestions.
  const free = page.getByRole("region", { name: "Motoboy livre" });
  await expect(free).toContainText("2 pedidos esperando");
  await free.getByRole("button", { name: "Agora não" }).click();
  await expect(free).toHaveCount(0);
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

test("sugerir rotas com dois motoboys livres divide a rota para nenhum ficar parado", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  Object.assign(backend.board, { storeLocation: { latitude: -23.0, longitude: -46.8 } });
  // Eva joins the line after Bruno: two couriers waiting.
  backend.board.couriers.push({ shiftId: "s-eva", name: "Eva Rocha", status: "AVAILABLE", linkActive: true,
    requestedAt: new Date(Date.now() - 30 * 60_000).toISOString(), availableSince: new Date(Date.now() - 5 * 60_000).toISOString() });
  const pinned = (reference: string, customer: string, address: string, neighborhood: string, latitude: number, longitude: number) => ({
    ...structuredClone(backend.board.orders[0]), deliveryId: `d-${reference}`, orderId: `o-${reference}`, reference, customer,
    address, neighborhood, latitude, longitude });
  // One way south: two on a street in Centro, two further down in Jardim Sul, the bairro next door.
  // With one courier they would all go together.
  backend.board.orders.push(
    pinned("2201", "Paula Rocha", "Rua das Acácias, 55", "Centro", -23.0225, -46.8),
    pinned("2202", "Rui Campos", "R. das Acacias, 140", "Centro", -23.0233, -46.8003),
    pinned("2203", "Sara Lopes", "Rua Sul, 1", "Jardim Sul", -23.045, -46.8),
    pinned("2204", "Teo Dias", "Rua Sul, 300", "Jardim Sul", -23.047, -46.8));
  backend.handlers.get_neighborhood_centers = () => ({ json: [
    { neighborhood: "Centro", latitude: -23.0229, longitude: -46.8, orders: 10 },
    { neighborhood: "Jardim Sul", latitude: -23.0355, longitude: -46.8, orders: 4 } ] });
  const calls = await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await page.route("**/api/routing/legs", route => route.fulfill({ status: 503, json: { message: "Tempos pelas ruas indisponíveis no momento." } }));
  await openPanel(page);
  const free = page.getByRole("region", { name: "Motoboy livre" });
  await free.getByRole("button", { name: "Agora não" }).click();
  await showArea(page, /^Montagem/);
  await page.getByRole("button", { name: "Sugerir rotas" }).click();
  const dialog = page.getByRole("dialog", { name: "Sugestões de rota" });
  await expect(dialog).toContainText("Com mais motoboys livres do que rotas, divide as maiores para nenhum ficar parado.");

  const first = dialog.getByRole("listitem", { name: "Rota sugerida 1" });
  await expect(first).toContainText("2 entregas");
  await expect(first).toContainText("Motoboy: Bruno Alves · próximo da fila");
  await expect(first).toContainText("#2201 Paula Rocha");
  await expect(first).toContainText("#2202 Rui Campos");
  await expect(first.locator(".ops-suggestion-split")).toHaveText(/^Dividida da rota de #2201 para nenhum motoboy ficar parado/);

  const second = dialog.getByRole("listitem", { name: "Rota sugerida 2" });
  await expect(second).toContainText("2 entregas");
  await expect(second).toContainText("Motoboy: Eva Rocha");
  // Its own base, and the reasons told again inside it; its customers no longer wait for Centro.
  const stops = second.locator(".ops-suggestion-stops > li");
  await expect(stops.nth(0)).toContainText("#2203 Sara Lopes");
  await expect(stops.nth(0)).toContainText("Pedido base da rota");
  await expect(stops.nth(1)).toContainText("#2204 Teo Dias");
  await expect(stops.nth(1)).toContainText("Mesma rua de #2203");
  await expect(second.locator(".ops-suggestion-split")).toHaveText(
    /^Dividida da rota de #2201 para nenhum motoboy ficar parado · um pedido chega até \d+ min antes$/);
  await expect(dialog.getByRole("listitem", { name: "Rota sugerida 3" })).toHaveCount(0);
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]);

  // Eva's route fills the Montagem with her.
  await second.getByRole("button", { name: "Usar esta rota na montagem" }).click();
  await expect(dialog).toBeHidden();
  const sequence = page.getByLabel("Sequência planejada").locator(".ops-sequence > li");
  await expect(sequence).toHaveCount(2);
  await expect(sequence.nth(0)).toContainText("#2203 · Sara Lopes");
  await page.getByRole("button", { name: "Atribuir rota", exact: false }).click();
  await expect.poll(() => backend.commandCalls().find(call => call.fn === "create_route")?.body).toMatchObject({
    p_shift_id: "s-eva", p_delivery_ids: ["d-2203", "d-2204"] });
  expect(calls.unexpected).toEqual([]);
  expect(errors).toEqual([]);
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
  await expect(form.getByRole("radio", { name: "Cartão" })).toBeChecked();
  await expect(form.getByLabel("Valor a cobrar (R$)")).toHaveValue("39,90");
  await form.getByRole("radio", { name: "Pix na entrega" }).check();
  await form.getByLabel("Nome do cliente").fill("Igor Nunes Filho");
  await form.getByLabel("Observações").fill("Interfone 12");
  await form.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Pedido #1049 atualizado." })).toBeVisible();
  await expect(page.locator(".ops-order").filter({ hasText: "#1049" })).toContainText("Igor Nunes Filho");
  const call = backend.commandCalls().find(item => item.fn === "update_order")!.body;
  expect(call).toMatchObject({ p_restaurant_id: testRestaurant.id, p_order_id: "o-1049", p_customer_name: "Igor Nunes Filho",
    p_notes: "Interfone 12", p_delivery_address: "Rua Sintética, 1049", p_keep_location: true,
    p_payment_method: "PIX", p_amount_due_cents: 3990, p_change_for_cents: null });
  await expect(page.locator(".ops-order").filter({ hasText: "#1049" }).locator(".ops-order-payment")).toContainText("Cobrar R$ 39,90 · Pix");
  expect(call).not.toHaveProperty("p_latitude");
  // Orders already in a route have no edit or cancel, only the customer's link.
  await expect(page.getByRole("button", { name: /^Editar pedido 1047/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("impressora deste computador: pedido impresso vira pedido do painel depois de conferido", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  const geocoding = await mockGeocoding(page);
  // The virtual printer program on this computer (tools/print-capture), with one receipt read.
  // Whole minutes: "Pedido feito em" keeps hour and minute.
  const receivedAt = new Date(Math.floor((Date.now() - 2 * 60_000) / 60_000) * 60_000).toISOString();
  const printed = { id: "job-1", receivedAt, externalId: "77 · 22/11/2026", app: null,
    order: { customer: "Maria Souza teste 01", phone: "11912345678", address: "Rua das Flores, 100", reference: "77" },
    found: ["customer", "phone", "address", "reference"] };
  let inbox = [printed];
  const taken: string[] = [];
  const panelHeaders: (string | undefined)[] = [];
  const cors = { "Access-Control-Allow-Origin": "*" };
  await page.route("http://127.0.0.1:9180/pedidos", route => {
    panelHeaders.push(route.request().headers()["x-rpm-painel"]);
    return route.fulfill({ json: { orders: inbox }, headers: cors });
  });
  await page.route("http://127.0.0.1:9180/pedidos/*/concluido", route => {
    const id = route.request().url().split("/").at(-2)!;
    taken.push(id);
    inbox = inbox.filter(item => item.id !== id);
    return route.fulfill({ status: 204, headers: cors });
  });
  await openPanel(page);
  await showArea(page, /^Pedidos/);
  // Off by default: the panel never reaches this computer's programs unless the store turns it on here.
  await expect(page.getByRole("region", { name: "Pedidos da impressora" })).toHaveCount(0);
  expect(panelHeaders).toEqual([]);

  await page.getByRole("button", { name: /abrir menu/ }).click();
  const menu = page.getByRole("dialog", { name: "Menu da loja" });
  await menu.getByRole("checkbox", { name: "Pedidos da impressora neste computador" }).check();
  await expect(menu.getByRole("status")).toHaveText("Ligado. Os pedidos impressos aparecem em Pedidos para conferir.");
  await menu.getByRole("button", { name: "Fechar menu" }).click();

  const banner = page.getByRole("region", { name: "Pedidos da impressora" });
  await expect(banner).toContainText("Pedido chegou pela impressora");
  await expect(banner).toContainText("Maria Souza teste 01 · #77");
  expect(panelHeaders.every(value => value === "1")).toBe(true);
  await banner.getByRole("button", { name: "Conferir e cadastrar" }).click();

  const form = page.locator("dialog[open]");
  // The kicker is hidden on phones; the notice says it everywhere.
  await expect(form.locator(".ops-kicker")).toHaveText("PEDIDO DA IMPRESSORA");
  await expect(form.getByText("Confira o que foi lido do cupom.", { exact: false })).toBeVisible();
  await expect(form.getByRole("status").filter({ hasText: "Lido do cupom: nome, WhatsApp, endereço e nº do pedido." }))
    .toContainText("Escolha o endereço na lista para confirmar no mapa. O cupom não diz o pagamento: marque se está pago ou quanto cobrar.");
  await expect(form.getByLabel("WhatsApp", { exact: true })).toHaveValue("(11) 91234-5678");
  await expect(form.getByLabel("Nome do cliente")).toHaveValue("Maria Souza teste 01");
  await expect(form.locator('input[name="reference"]')).toHaveValue("77");
  await expect(form.getByRole("combobox", { name: "Endereço" })).toHaveValue("Rua das Flores, 100");
  await expect.poll(() => geocoding.suggest).toEqual(["Rua das Flores, 100"]);
  await form.getByRole("option", { name: /Rua das Flores/ }).click();
  await expect(form.getByText("Localização confirmada", { exact: false })).toBeVisible();
  await form.getByLabel("Bairro").fill("Centro");
  await form.getByRole("radio", { name: "Já pago" }).check();
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toHaveCount(0);

  expect(backend.commandCalls().map(call => call.fn)).toEqual(["import_order"]);
  expect(backend.commandCalls()[0].body).toMatchObject({ p_source: "PRINTER", p_external_id: "77 · 22/11/2026",
    p_source_app: null, p_customer_name: "Maria Souza teste 01", p_customer_phone: "+5511912345678",
    p_reference: "77", p_neighborhood: "Centro", p_address_provider_id: resolvedAddress.providerId,
    p_ordered_at: receivedAt });
  expect(backend.commandCalls()[0].body).not.toHaveProperty("p_request_id");
  await expect.poll(() => taken).toEqual(["job-1"]);
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Pedido cadastrado. Aguardando despacho." })).toBeVisible();
  // The new order shows where it came from: the printer symbol.
  await expect(page.locator(".ops-order").filter({ hasText: "#77" }).locator(".ops-order-origin"))
    .toHaveText("Veio da impressora · código 77 · 22/11/2026");

  // The same receipt printed again: the panel says it was already there and changes nothing.
  inbox = [{ ...printed, id: "job-2" }];
  await expect(banner).toContainText("Maria Souza teste 01 · #77");
  await banner.getByRole("button", { name: "Conferir e cadastrar" }).click();
  await expect(form.getByLabel("Nome do cliente")).toHaveValue("Maria Souza teste 01");
  await form.getByLabel("Bairro").fill("Centro");
  await form.getByRole("radio", { name: "Já pago" }).check();
  await form.getByRole("button", { name: "Cadastrar pedido" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Esse pedido já estava no painel (código 77 · 22/11/2026). Nada foi alterado." }))
    .toBeVisible();
  await expect.poll(() => taken).toEqual(["job-1", "job-2"]);
  expect(backend.board.orders.filter(order => order.reference === "77")).toHaveLength(1);

  // Discarding leaves the order out of the panel.
  inbox = [{ ...printed, id: "job-3", externalId: "78 · 22/11/2026", order: { ...printed.order, reference: "78" } }];
  await banner.getByRole("button", { name: "Descartar" }).click();
  await expect(banner).toHaveCount(0);
  expect(taken).toEqual(["job-1", "job-2", "job-3"]);
  expect(backend.commandCalls().filter(call => call.fn === "import_order")).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("impressora em modo automático: endereço certo vai direto para a fila; o resto espera conferir", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  // The map finds "Rua das Flores, 120" with its bairro.
  const geocoding = await mockGeocoding(page, { neighborhood: "Jardim Paulista" });
  const receivedAt = new Date(Math.floor((Date.now() - 2 * 60_000) / 60_000) * 60_000).toISOString();
  const good = { id: "job-ok", receivedAt, externalId: "81 · 22/11/2026", app: null,
    order: { customer: "Rita Alves", phone: "11912340081", address: "R. das Flores, 120", complement: "Apto 4",
      notes: "Sem cebola", reference: "81" }, found: [], payment: { method: "CASH", amountDueCents: 6190, changeForCents: 10000 } };
  const unknown = { id: "job-check", receivedAt, externalId: "82 · 22/11/2026", app: null,
    order: { customer: "Caio Lima", phone: "11912340082", address: "Rua Inventada, 9", reference: "82" }, found: [],
    payment: { method: "PAID" } };
  // Same street and number, but the receipt says Itatiba and the map only finds it in São Paulo.
  const elsewhere = { id: "job-city", receivedAt, externalId: "83 · 22/11/2026", app: null,
    order: { customer: "Lia Prado", phone: "11912340083", address: "Rua das Flores, 120, Itatiba", city: "Itatiba",
      reference: "83" }, found: [], payment: { method: "PAID" } };
  // Everything else checks out, but the receipt does not say how much to collect: the courier must know.
  const unpaid = { id: "job-pay", receivedAt, externalId: "84 · 22/11/2026", app: null,
    order: { customer: "Davi Rocha", phone: "11912340084", address: "Rua das Flores, 120", reference: "84" }, found: [],
    payment: { method: "CARD" } };
  let inbox = [good, unknown, elsewhere, unpaid];
  const taken: string[] = [];
  const cors = { "Access-Control-Allow-Origin": "*" };
  await page.route("http://127.0.0.1:9180/pedidos", route => route.fulfill({ json: { orders: inbox }, headers: cors }));
  await page.route("http://127.0.0.1:9180/pedidos/*/concluido", route => {
    const id = route.request().url().split("/").at(-2)!;
    taken.push(id);
    inbox = inbox.filter(item => item.id !== id);
    return route.fulfill({ status: 204, headers: cors });
  });
  await openPanel(page);
  await showArea(page, /^Pedidos/);
  await page.getByRole("button", { name: /abrir menu/ }).click();
  const menu = page.getByRole("dialog", { name: "Menu da loja" });
  await expect(menu.getByRole("checkbox", { name: "Cadastrar sozinho" }), "only with the printer on").toHaveCount(0);
  // Both on before the first answer, so no order is offered for manual checking first.
  await page.route("http://127.0.0.1:9180/pedidos", route => route.fulfill({ json: { orders: [] }, headers: cors }));
  await menu.getByRole("checkbox", { name: "Pedidos da impressora neste computador" }).check();
  await menu.getByRole("checkbox", { name: "Cadastrar sozinho" }).check();
  await menu.getByRole("button", { name: "Fechar menu" }).click();
  await page.unroute("http://127.0.0.1:9180/pedidos");
  await page.route("http://127.0.0.1:9180/pedidos", route => route.fulfill({ json: { orders: inbox }, headers: cors }));

  // The good receipt is saved alone, with the map's address and the default promise.
  await expect.poll(() => taken).toContain("job-ok");
  const imported = backend.commandCalls().filter(call => call.fn === "import_order");
  expect(imported).toHaveLength(1);
  expect(imported[0].body).toMatchObject({ p_source: "PRINTER", p_external_id: "81 · 22/11/2026", p_customer_name: "Rita Alves",
    p_customer_phone: "+5511912340081", p_delivery_address: resolvedAddress.address, p_neighborhood: "Jardim Paulista",
    p_complement: "Apto 4", p_notes: "Sem cebola", p_reference: "81", p_promised_minutes: 60, p_ordered_at: receivedAt,
    p_latitude: resolvedAddress.latitude, p_address_provider_id: resolvedAddress.providerId,
    p_payment_method: "CASH", p_amount_due_cents: 6190, p_change_for_cents: 10000 });
  await expect(page.getByRole("status").filter({ hasText: "Pedido #81 da impressora cadastrado sozinho: Rita Alves" })).toBeVisible();
  await expect(page.locator(".ops-order").filter({ hasText: "#81" }).locator(".ops-order-origin svg")).toBeVisible();

  // The other one waits, saying why.
  const banner = page.getByRole("region", { name: "Pedidos da impressora" });
  await expect(banner).toContainText("3 pedidos da impressora para conferir");
  await expect(banner).toContainText("Caio Lima · #82");
  await expect(banner).toContainText("Não cadastrei sozinho: não achei esse endereço no mapa com certeza.");
  // The receipt's city goes with the search, and an address found only in another city waits too.
  expect(geocoding.suggest).toEqual(["R. das Flores, 120", "Rua Inventada, 9", "Rua das Flores, 120, Itatiba"]);
  await banner.getByRole("button", { name: "Conferir e cadastrar" }).click();
  const form = page.locator("dialog[open]");
  await expect(form.getByRole("status").filter({ hasText: "Não cadastrei sozinho: não achei esse endereço no mapa com certeza." }))
    .toBeVisible();
  await expect(form.getByLabel("Nome do cliente")).toHaveValue("Caio Lima");
  await form.getByRole("button", { name: "Fechar novo pedido" }).click();
  expect(taken).toEqual(["job-ok"]);
  await banner.getByRole("button", { name: "Descartar" }).click();
  await expect(banner).toContainText("2 pedidos da impressora para conferir");
  await expect(banner).toContainText("Lia Prado · #83");
  await expect(banner).toContainText("Não cadastrei sozinho: o mapa só achou esse endereço fora de Itatiba.");
  expect(taken).toEqual(["job-ok", "job-check"]);
  await banner.getByRole("button", { name: "Descartar" }).click();
  await expect(banner).toContainText("Pedido da impressora para conferir");
  await expect(banner).toContainText("Davi Rocha · #84");
  await expect(banner).toContainText("Não cadastrei sozinho: o cupom não diz quanto cobrar.");
  expect(geocoding.suggest, "the payment is checked before searching the map").not.toContain("Rua das Flores, 120");
  expect(backend.commandCalls().filter(call => call.fn === "import_order")).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("prazo padrão: clicar em Padrão 60 min muda o prazo dos próximos pedidos da loja", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await openPanel(page);
  await showArea(page, /^Pedidos/);
  await page.getByRole("button", { name: "Padrão 60 min, mudar prazo padrão" }).click();
  const dialog = page.getByRole("dialog", { name: "Prazo padrão" });
  await expect(dialog).toContainText("Vale para todos os aparelhos da loja.");
  await expect(dialog.getByLabel("Prazo padrão (minutos)")).toHaveValue("60");
  await dialog.getByLabel("Prazo padrão (minutos)").fill("45");
  await dialog.getByRole("button", { name: "Salvar prazo" }).click();
  await expect(dialog).toBeHidden();
  expect(backend.commandCalls().filter(call => call.fn === "set_default_promise").map(call => call.body))
    .toEqual([{ p_restaurant_id: testRestaurant.id, p_minutes: 45 }]);
  await expect(page.getByRole("button", { name: "Padrão 45 min, mudar prazo padrão" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Prazo padrão: 45 min." })).toBeVisible();
  // The next order starts with the new default.
  await page.getByRole("button", { name: "Novo pedido" }).first().click();
  await expect(page.locator("dialog[open]").getByLabel("Prazo prometido (minutos)")).toHaveValue("45");
  expect(errors).toEqual([]);
});

test("pedido importado mostra de onde veio: símbolo da impressora ou nome do app", async ({ page }) => {
  const errors = watchErrors(page);
  const backend = storeBackend();
  const read = backend.handlers.get_operations_board;
  // 1048 came from the printer capture, 1049 from a delivery app; a new order is typed in the panel.
  const handlers = { ...backend.handlers, get_operations_board: async (body: Record<string, unknown>) => {
    const reply = await read(body);
    return reply === "abort" ? reply : { json: { ...(reply.json as object), orderSources: [
      { deliveryId: "d-1048", source: "PRINTER", app: null, externalId: "5127" },
      { deliveryId: "d-1049", source: "OPEN_DELIVERY", app: "99Food", externalId: "XY-9" },
    ] } };
  } };
  await mockSupabase(page, { existing: true, rpc: handlers });
  await openPanel(page);
  await showArea(page, /^Pedidos/);
  const printed = page.locator(".ops-order").filter({ hasText: "#1048" }).locator(".ops-order-origin");
  await expect(printed.locator("svg")).toBeVisible();
  await expect(printed).toHaveText("Veio da impressora · código 5127");
  await expect(printed).toHaveAttribute("title", "Veio da impressora · código 5127");
  const fromApp = page.locator(".ops-order").filter({ hasText: "#1049" }).locator(".ops-order-origin");
  await expect(fromApp).toHaveText("Origem: 99Food");
  await expect(fromApp).toHaveAttribute("title", "Veio do app de delivery (99Food) · código XY-9");
  expect(errors).toEqual([]);
});
