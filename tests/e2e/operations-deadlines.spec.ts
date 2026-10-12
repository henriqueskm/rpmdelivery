import { test, expect, type Page } from "@playwright/test";

test.use({ timezoneId: "America/Sao_Paulo" });
const minute = 60_000;
const epoch = Date.parse("2026-10-12T18:00:00Z");
async function frozen(page: Page) {
  await page.clock.install({ time: new Date(epoch - 10 * minute) });
  await page.clock.pauseAt(new Date(epoch));
  await page.goto("/preview/operacao");
  await expect(page.getByRole("checkbox", { name: "Selecionar pedido 1048", exact: true })).toBeVisible();
}
async function area(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.isVisible()) await tab.click();
}
const route = (page: Page) => page.getByRole("article", { name: "Rota R-42", exact: true });
const counter = (page: Page, ref: string) => page.locator(".ops-order").filter({ has: page.getByRole("checkbox", { name: `Selecionar pedido ${ref}`, exact: true }) }).locator(".ops-order-deadline");
const deadline = (page: Page, ref: string) => page.getByRole("button", { name: `Editar prazo do pedido ${ref}`, exact: true });

test("prazo original, override, contagem compartilhada e padrão para novos pedidos sem reordenação", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await frozen(page);
  const references = await page.locator(".ops-order-ref").allTextContents();
  await expect(counter(page, "1048")).toContainText("Restam 54m");
  await expect(counter(page, "1047")).toContainText("Próximo · 8m");
  await expect(counter(page, "1046")).toContainText("Vencido · 8m");
  const bar = page.getByRole("progressbar", { name: "Tempo restante do pedido 1047", exact: true });
  await expect(bar).toHaveAttribute("aria-valuenow", "13");
  await expect(counter(page, "1048").locator(".ops-deadline")).toHaveClass(/green/);
  await expect(counter(page, "1047").locator(".ops-deadline")).toHaveClass(/orange/);
  await expect(counter(page, "1046").locator(".ops-deadline")).toHaveClass(/red/);
  await deadline(page, "1048").click();
  const editor = page.getByRole("dialog", { name: "Editar prazo", exact: true });
  await editor.getByLabel("Pedido feito em").fill("2026-10-12T14:30");
  await editor.getByLabel("Prazo prometido (minutos)").fill("15");
  await editor.getByRole("button", { name: "Salvar prazo (demo)" }).click();
  await expect(counter(page, "1048")).toContainText("Vencido · 15m");
  await expect(counter(page, "1048")).toContainText("Até 14:45");
  await deadline(page, "1048").click();
  await editor.getByLabel("Prazo prometido (minutos)").fill("45");
  await editor.getByRole("button", { name: "Salvar prazo (demo)" }).click();
  await page.clock.runFor(6 * minute + 1_000);
  await expect(counter(page, "1048")).toContainText("Próximo · 9m");
  await expect(counter(page, "1047")).toContainText("Crítico · 2m");
  await expect(bar).toHaveAttribute("aria-valuenow", "3");
  await expect(counter(page, "1047").locator(".ops-deadline")).toHaveClass(/red/);
  await page.clock.runFor(4 * minute);
  await expect(counter(page, "1047")).toContainText("Vencido · 2m");
  expect(await page.locator(".ops-order-ref").allTextContents()).toEqual(references);
  await page.getByRole("button", { name: "Configurar prazo padrão" }).click();
  const settings = page.getByRole("dialog", { name: "Prazo padrão", exact: true });
  await settings.getByLabel("Prazo padrão (minutos)").fill("90");
  await settings.getByRole("button", { name: "Salvar prazo (demo)" }).click();
  await deadline(page, "1048").click();
  await expect(editor.getByLabel("Prazo prometido (minutos)")).toHaveValue("45");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Novo pedido", exact: true });
  await expect(form.getByLabel("Pedido feito em")).toHaveValue("2026-10-12T15:10");
  await expect(form.getByLabel("Prazo prometido (minutos)")).toHaveValue("90");
  await form.getByLabel("Pedido feito em").fill("2026-10-12T14:50");
  await form.getByLabel("Nome do cliente", { exact: true }).fill("Cliente fictício prazo");
  await form.getByLabel("WhatsApp", { exact: true }).fill("11900000000");
  await form.getByLabel("Endereço", { exact: true }).fill("Rua demonstrativa, 12");
  await form.getByLabel("Bairro", { exact: true }).fill("Centro");
  await form.getByRole("button", { name: "Cadastrar pedido (demo)" }).click();
  await expect(counter(page, "1049")).toContainText("Restam 1h 10m");
  await expect(counter(page, "1049")).toContainText("Até 16:20");
  expect(errors).toEqual([]);
});

test("motoboy confere PREPARING bloqueado, liberação única, ordem preservada e composição exige nova liberação", async ({ page }) => {
  const unexpected: string[] = [];
  page.on("request", r => { if (r.method() !== "GET" || new URL(r.url()).hostname !== "127.0.0.1") unexpected.push(r.url()); });
  await frozen(page);
  await area(page, "Rotas");
  await route(page).getByRole("button", { name: "Editar prazo do pedido 1041" }).click();
  const editor = page.getByRole("dialog", { name: "Editar prazo", exact: true });
  await editor.getByLabel("Prazo prometido (minutos)").fill("20");
  await editor.getByRole("button", { name: "Salvar prazo (demo)" }).click();
  await route(page).getByRole("button", { name: "Visão do motoboy (demo)" }).click();
  const driver = page.getByRole("dialog", { name: "Aplicativo do motoboy" });
  const start = driver.getByRole("button", { name: "Recolhi os pedidos · Iniciar rota" });
  await expect(driver).toContainText("Aguardando liberação");
  await expect(driver.locator(".ops-courier-deliveries li").first()).toContainText("#1042");
  await expect(driver.locator(".ops-urgent-deadline")).toContainText("#1041");
  await expect(driver.locator(".ops-urgent-deadline")).toContainText("Próximo · 8m");
  await expect(start).toBeDisabled();
  await page.keyboard.press("Escape");
  await route(page).getByRole("button", { name: "Liberar retirada", exact: true }).click();
  await expect(route(page)).toContainText("Pronto para retirada");
  await expect(route(page)).toContainText("Em preparação");
  await area(page, "Motoboys");
  await expect(page.locator(".ops-courier").filter({ hasText: "Marcos Pereira" })).toContainText("Reservado");
  await area(page, "Rotas");
  await route(page).getByRole("button", { name: "Editar montagem" }).click();
  await page.getByRole("button", { name: "Mover pedido 1041 para cima" }).click();
  await page.getByRole("button", { name: "Salvar montagem (demo)" }).click();
  await expect(route(page)).toContainText("Pronto para retirada");
  await route(page).getByRole("button", { name: "Visão do motoboy (demo)" }).click();
  await expect(start).toBeEnabled();
  await expect(driver.locator(".ops-courier-deliveries li").first()).toContainText("#1041");
  await page.keyboard.press("Escape");
  await route(page).getByRole("button", { name: "Editar montagem" }).click();
  await page.getByRole("button", { name: "Remover pedido 1042 da montagem" }).click();
  await area(page, "Pedidos");
  await page.getByRole("checkbox", { name: "Selecionar pedido 1048", exact: true }).check();
  if (await page.getByRole("tab", { name: /^Montagem/ }).isVisible()) await page.getByRole("tab", { name: /^Montagem/ }).click();
  await page.getByRole("button", { name: "Salvar montagem (demo)" }).click();
  await expect(route(page)).toContainText("Aguardando liberação");
  await route(page).getByRole("button", { name: "Visão do motoboy (demo)" }).click();
  await expect(start).toBeDisabled();
  await page.keyboard.press("Escape");
  await route(page).getByRole("button", { name: "Liberar retirada", exact: true }).click();
  await route(page).getByRole("button", { name: "Visão do motoboy (demo)" }).click();
  await start.click();
  await expect(driver).toContainText("Em rota");
  await expect(driver.locator(".ops-courier-deliveries li > strong")).toHaveText(["#1041 · André Mendes", "#1048 · Mariana Costa"]);
  await page.keyboard.press("Escape");
  await expect(route(page).getByRole("button", { name: "Editar montagem" })).toHaveCount(0);
  await expect(route(page).getByRole("button", { name: "Liberar retirada" })).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("prazo em 320/375/390 mantém toque, teclado, textos longos e rejeita data futura/minutos inválidos", async ({ page }) => {
  await frozen(page);
  await page.getByLabel("Cenário").selectOption("worst");
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await deadline(page, "1048").press("Enter");
    const editor = page.getByRole("dialog", { name: "Editar prazo", exact: true });
    await expect(editor.getByLabel("Pedido feito em")).toBeFocused();
    await editor.getByLabel("Pedido feito em").fill("2026-10-13T15:00");
    await editor.getByRole("button", { name: "Salvar prazo (demo)" }).click();
    await expect(editor).toBeVisible();
    expect(await editor.getByLabel("Pedido feito em").evaluate(el => (el as HTMLInputElement).validity.valid)).toBe(false);
    await editor.getByLabel("Pedido feito em").fill("2026-10-12T14:00");
    await editor.getByLabel("Prazo prometido (minutos)").fill("0");
    await editor.getByRole("button", { name: "Salvar prazo (demo)" }).click();
    await expect(editor).toBeVisible();
    expect(await editor.getByLabel("Prazo prometido (minutos)").evaluate(el => (el as HTMLInputElement).validity.valid)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(deadline(page, "1048")).toBeFocused();
    const box = await deadline(page, "1048").boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("rota com vinte pedidos mantém prazo urgente e início bloqueado acessíveis em 320/375/390", async ({ page }) => {
  await frozen(page);
  await page.getByLabel("Cenário").selectOption("busy");
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 320) {
      await page.getByRole("checkbox", { name: "Selecionar visíveis", exact: true }).check();
      await page.getByRole("tab", { name: /^Montagem/ }).click();
      await page.getByRole("button", { name: "Atribuir rota (demo)" }).click();
    }
    await page.getByRole("article", { name: "Rota R-43", exact: true }).getByRole("button", { name: "Visão do motoboy (demo)" }).click();
    const driver = page.getByRole("dialog", { name: "Aplicativo do motoboy" });
    const start = driver.getByRole("button", { name: "Recolhi os pedidos · Iniciar rota" });
    await expect(start).toBeDisabled();
    await expect(driver.locator(".ops-urgent-deadline")).toContainText("#2019");
    expect(await driver.locator(".ops-courier-deliveries").evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(150);
    for (const control of [start, driver.locator(".ops-urgent-deadline")]) {
      const box = await control.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    }
    expect(await driver.locator(".ops-courier-deliveries li").count()).toBe(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
  }
});
