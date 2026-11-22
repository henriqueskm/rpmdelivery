import { test, expect, type Page } from "@playwright/test";
import { emptyBoard, mockSupabase, testRestaurant, type RpcHandler } from "./support/supabase";
import { mockGeocoding, resolvedAddress } from "./support/geocoding";
import { storeBackend } from "./support/store-backend";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill("operador@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("Test-only-password-123!");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("dados da loja: o dono troca nome, celular e endereço confirmado", async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  const update: RpcHandler = body => { saved.push(body); return { json: { id: testRestaurant.id } }; };
  await mockSupabase(page, { existing: true, rpc: { update_restaurant_profile: update } });
  await mockGeocoding(page);
  await signIn(page);
  await page.getByRole("button", { name: `${testRestaurant.name}, abrir menu` }).click();
  await page.getByRole("dialog", { name: "Menu da loja" }).getByRole("link", { name: "Dados da loja" }).click();
  await expect(page).toHaveURL(/\/loja$/);
  await expect(page.getByRole("heading", { name: "Dados da loja" })).toBeVisible();
  await expect(page.getByLabel("Nome da loja")).toHaveValue(testRestaurant.name);
  await expect(page.getByText(testRestaurant.address, { exact: true })).toBeVisible();

  // Name and phone only: the address keys stay out of the command.
  await page.getByLabel("Nome da loja").fill("Cozinha da Vila Nova");
  await page.getByLabel("Celular da loja (opcional)").fill("11987654321");
  await expect(page.getByLabel("Celular da loja (opcional)")).toHaveValue("(11) 98765-4321");
  await page.getByRole("button", { name: "Salvar dados da loja" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dados da loja salvos." })).toBeVisible();
  expect(saved[0]).toEqual({ p_restaurant_id: testRestaurant.id, p_name: "Cozinha da Vila Nova", p_phone: "+5511987654321" });

  // A new address saves only once picked from the list, with its pin.
  await page.getByRole("button", { name: "Trocar endereço" }).click();
  const save = page.getByRole("button", { name: "Salvar dados da loja" });
  await expect(save).toBeDisabled();
  await page.getByRole("combobox", { name: "Endereço", exact: true }).fill("Rua das Flores, 120");
  await page.getByRole("option", { name: "Rua das Flores, 120 São Paulo, Brasil" }).click();
  await expect(page.getByText("✓ Endereço confirmado", { exact: true })).toBeVisible();
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Dados da loja salvos." })).toBeVisible();
  expect(saved[1]).toMatchObject({ p_address: resolvedAddress.address, p_latitude: resolvedAddress.latitude,
    p_longitude: resolvedAddress.longitude, p_address_provider: "mapbox", p_address_provider_id: resolvedAddress.providerId });

  // Phone width: nothing scrolls sideways.
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("dados da loja: o operador só consulta", async ({ page }) => {
  await mockSupabase(page, { existing: true, role: "OPERATOR" });
  await signIn(page);
  await page.goto("/loja");
  await expect(page.getByText("Somente o dono ou um gerente da loja altera estes dados.")).toBeVisible();
  await expect(page.getByLabel("Nome da loja")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Trocar endereço" })).toHaveCount(0);
  // The montagem limits are read-only too.
  const limits = page.getByRole("form", { name: "Montagem automática" });
  await expect(limits.getByText("Somente o dono ou um gerente da loja altera estes limites.")).toBeVisible();
  await expect(limits.getByLabel("Entregas por rota")).toBeDisabled();
});

test("dados da loja: o dono ajusta os limites da montagem automática", async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  await mockSupabase(page, { existing: true, rpc: {
    set_route_settings: body => {
      saved.push(body);
      return { json: { maxStops: body.p_max_stops, maxDetourMinutes: body.p_max_detour_minutes,
        neighborMeters: body.p_neighbor_meters, canEdit: true } };
    },
  } });
  await signIn(page);
  await page.goto("/loja");
  const limits = page.getByRole("form", { name: "Montagem automática" });
  await expect(limits.getByLabel("Entregas por rota")).toHaveValue("8");
  await expect(limits.getByLabel("Desvio máximo para ir no caminho (minutos)")).toHaveValue("10");
  await expect(limits.getByLabel("Bairros vizinhos até (km)")).toHaveValue("2");

  // Out of range: nothing is sent.
  await limits.getByLabel("Entregas por rota").fill("9");
  await expect(limits.getByRole("button", { name: "Salvar limites" })).toBeDisabled();
  await limits.getByLabel("Entregas por rota").fill("5");
  await limits.getByLabel("Desvio máximo para ir no caminho (minutos)").fill("7");
  await limits.getByLabel("Bairros vizinhos até (km)").fill("1,5");
  await limits.getByRole("button", { name: "Salvar limites" }).click();
  await expect(limits.getByRole("status")).toContainText("Limites salvos.");
  expect(saved).toEqual([{ p_restaurant_id: testRestaurant.id, p_max_stops: 5, p_max_detour_minutes: 7, p_neighbor_meters: 1500 }]);
});

test("painel avisa a entrega confirmada longe do endereço", async ({ page }) => {
  const now = new Date().toISOString();
  const order = (id: string, customer: string, deliveryStatus: string) => ({
    deliveryId: id, orderId: `o-${id}`, reference: id.slice(2), customer, phone: "+5511988887777",
    address: "Rua de teste, 1", neighborhood: "Centro", complement: null, notes: null,
    orderedAt: now, createdAt: now, promisedMinutes: 60, orderStatus: "DELIVERING", deliveryStatus, failedAttempts: 0,
  });
  const board = {
    ...emptyBoard(),
    couriers: [{ shiftId: "s-1", name: "Ana Souza", status: "ON_ROUTE", linkActive: true, requestedAt: now, availableSince: now }],
    routes: [{ id: "r-1", reference: "R-1", shiftId: "s-1", status: "ON_ROUTE", compositionVersion: 1,
      pickupReleasedAt: now, deliveryIds: ["d-2001", "d-2002"], retryDeliveryIds: [] }],
    orders: [{ ...order("d-2001", "Helena Prado", "DELIVERED"), orderStatus: "DELIVERED" }, order("d-2002", "Igor Nunes", "NEXT")],
    farDeliveries: [{ deliveryId: "d-2001", routeId: "r-1", distanceMeters: 1234, reportedAt: now }],
  };
  await mockSupabase(page, { existing: true, rpc: { get_operations_board: () => ({ json: board }) } });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Central de operações" })).toBeVisible();
  // Routes live in "Acompanhar rotas".
  await page.locator(".ops-follow-routes").click();
  const routes = page.getByRole("dialog", { name: "Acompanhar rotas" });
  await expect(routes.getByText("! Entregue a 1,2 km do endereço")).toBeVisible();
  await expect(routes.getByText("1 entrega confirmada longe do endereço")).toBeVisible();
});

test("menu da loja: páginas, pagamentos e sair com confirmação", async ({ page }) => {
  const backend = storeBackend();
  await mockSupabase(page, { existing: true, rpc: backend.handlers });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Central de operações" })).toBeVisible();
  // The top line keeps the operational buttons; the account corner is the menu.
  await expect(page.getByRole("button", { name: "Acompanhar rotas" })).toBeVisible();
  await page.getByRole("button", { name: `${testRestaurant.name}, abrir menu` }).click();
  const menu = page.getByRole("dialog", { name: "Menu da loja" });
  await expect(menu.getByRole("link", { name: "Central de despacho" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Motoboys e convites" })).toHaveAttribute("href", "/motoboys");
  await expect(menu.getByRole("link", { name: "Dados da loja" })).toHaveAttribute("href", "/loja");
  for (const item of await menu.locator("nav a, nav button, .ops-drawer-foot button").all())
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await menu.getByRole("button", { name: "Pagamentos dos motoboys" }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Pagamento dos motoboys" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: `${testRestaurant.name}, abrir menu` }).click();
  await menu.getByRole("button", { name: "Sair", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Sair da conta?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toBeHidden();
  await expect(page).toHaveURL(/\/dashboard$/);
});
