import { expect, test } from "@playwright/test";
import { mockSupabase, testRestaurant } from "./support/supabase";
import { enterOnboarding, geoPayload, mockGeocoding, selectAddress } from "./support/geocoding";

test("endereço confirmado, mapa e celular E.164 no RPC", async ({ page }) => {
  const calls = await mockSupabase(page);
  await mockGeocoding(page);
  await enterOnboarding(page);
  const submit = page.getByRole("button", { name: "Preparar meu restaurante" });
  await expect(submit).toBeDisabled();
  await selectAddress(page);
  await expect(page.getByRole("img", { name: /Mapa do endereço confirmado/ })).toBeVisible();
  await page.getByLabel("Telefone (opcional)").fill("1191234567");
  await expect(submit).toBeDisabled();
  await page.getByLabel("Telefone (opcional)").fill("11812345678");
  await expect(submit).toBeDisabled();
  await page.getByLabel("Telefone (opcional)").fill("11912345678");
  await expect(page.getByLabel("Telefone (opcional)")).toHaveValue("(11) 91234-5678");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(calls.rpc).toEqual([{ p_name: testRestaurant.name, ...geoPayload, p_phone: "+5511912345678" }]);
});

test("mínimo de caracteres, debounce, limite de cinco e teclado/Escape", async ({ page }) => {
  await mockSupabase(page);
  const calls = await mockGeocoding(page, { many: true });
  await enterOnboarding(page);
  const input = page.getByRole("combobox", { name: "Endereço", exact: true });
  await page.clock.install();
  await input.fill("Ru");
  await page.clock.runFor(500);
  expect(calls.suggest).toEqual([]);
  await input.fill("Rua");
  await page.clock.runFor(200);
  expect(calls.suggest).toEqual([]);
  await input.fill("Rua das");
  await page.clock.runFor(299);
  expect(calls.suggest).toEqual([]);
  await page.clock.runFor(1);
  await expect(page.getByRole("option")).toHaveCount(5);
  expect(calls.suggest).toEqual(["Rua das"]);
  await input.press("ArrowDown");
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowUp");
  await expect(page.getByRole("option").last()).toHaveAttribute("aria-selected", "true");
  await input.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await input.press("ArrowUp");
  await expect(page.getByRole("option").last()).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page.getByText("✓ Endereço confirmado", { exact: true })).toBeVisible();
  expect(calls.resolve).toEqual(["mapbox_test_id"]);
});

test("Escape durante debounce cancela a busca e não deixa loading preso", async ({ page }) => {
  await mockSupabase(page);
  const calls = await mockGeocoding(page);
  await enterOnboarding(page);
  await page.clock.install();
  const input = page.getByRole("combobox", { name: "Endereço", exact: true });
  await input.fill("Rua de teste");
  await input.press("Escape");
  await page.clock.runFor(500);
  expect(calls.suggest).toEqual([]);
  await expect(page.getByText("Buscando endereços…", { exact: true })).toHaveCount(0);
});

test("nova busca cancela request anterior e edição invalida coordenadas imediatamente", async ({ page }) => {
  await mockSupabase(page);
  await mockGeocoding(page, { slow: true });
  await enterOnboarding(page);
  const input = page.getByRole("combobox", { name: "Endereço", exact: true });
  const failed: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().endsWith("/suggest")) failed.push(request.failure()?.errorText ?? "");
  });
  await input.fill("Rua anterior");
  await expect(page.getByText("Buscando endereços…", { exact: true })).toBeVisible();
  await input.fill("Rua nova");
  await expect.poll(() => failed.length).toBe(1);
  expect(failed[0]).toContain("ERR_ABORTED");
  await page.getByRole("option").first().click();
  await expect(page.getByText("Confirmando localização…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preparar meu restaurante" })).toBeDisabled();
  await expect(page.getByText("✓ Endereço confirmado", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preparar meu restaurante" })).toBeEnabled();
  await input.press("End");
  await input.press("a");
  await expect(page.getByText("✓ Endereço confirmado", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: /Mapa do endereço confirmado/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preparar meu restaurante" })).toBeDisabled();
});

for (const scenario of ["empty", "error", "resolveError"] as const) {
  test(`busca com ${scenario} não libera envio`, async ({ page }) => {
    const calls = await mockSupabase(page);
    await mockGeocoding(page, { [scenario]: true });
    await enterOnboarding(page);
    await page.getByRole("combobox", { name: "Endereço", exact: true }).fill("Rua das Flores");
    if (scenario === "resolveError") await page.getByRole("option").first().click();
    await expect(page.getByText(scenario === "empty" ? /Nenhum endereço encontrado/ : /Não foi possível confirmar o endereço/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Preparar meu restaurante" })).toBeDisabled();
    expect(calls.rpc).toEqual([]);
  });
}
