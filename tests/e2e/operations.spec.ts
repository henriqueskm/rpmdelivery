import { expect, test, type Page } from "@playwright/test";
import { mockSupabase } from "./support/supabase";

async function area(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.isVisible()) await tab.click();
}
const route = (page: Page, reference: string) =>
  page.getByRole("article", { name: `Rota ${reference}`, exact: true });

test("pico preserva área útil no desktop e atribuição acessível no mobile", async ({ page }) => {
  for (const [width, height] of [[1280, 800], [1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/preview/operacao?scenario=busy");
    // Fontes locais precisam estar prontas antes de medir a geometria das linhas.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.getByRole("checkbox", { name: "Selecionar visíveis", exact: true }).check();
    const completeRows = async (selector: string) => page.locator(selector).evaluateAll((rows) => {
      const list = rows[0].closest(".ops-panel-scroll")!.getBoundingClientRect();
      return rows.filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.top >= Math.max(0, list.top) && rect.bottom <= Math.min(innerHeight, list.bottom);
      }).length;
    });
    expect(await completeRows(".ops-order")).toBeGreaterThanOrEqual(width === 390 ? 4 : 6);
    const builderTab = page.getByRole("tab", { name: /^Montagem/ });
    if (await builderTab.isVisible()) await builderTab.click();
    expect(await completeRows(".ops-sequence li")).toBeGreaterThanOrEqual(3);
    if (width === 390) {
      const bounds = await page.getByRole("button", { name: "Atribuir rota (demo)" }).boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    }
    await expect(page.getByText("Demonstração com dados fictícios.", { exact: true })).toBeVisible();
  }
});

test("montagem com textos extremos mantém controles e fallback de toque em 320/390", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/preview/operacao?scenario=worst");
    await expect(page.locator("#ops-panel-orders .ops-panel-footer")).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Selecionar visíveis", exact: true }).check();
    await page.getByRole("tab", { name: /^Montagem/ }).click();
    const buttons = page.locator(".ops-sequence-controls button");
    expect(await buttons.evaluateAll(elements => elements.every(el => {
      const rect = el.getBoundingClientRect();
      return rect.width >= 44 && rect.height >= 44;
    }))).toBe(true);
    await expect(page.locator(".ops-stop-content").first()).toContainText("Maria Aparecida de Albuquerque e Vasconcelos");
    await page.getByRole("button", { name: "Mover pedido 1048 para baixo" }).press("Enter");
    await expect(page.locator(".ops-stop-content").nth(1)).toContainText("#1048");
    await page.getByRole("button", { name: "Remover pedido 1048 da montagem" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Atribuir rota (demo)" })).toBeEnabled();
  }
});

test("cadastro e despacho locais: reserva, início pelo motoboy, bloqueio e retorno à fila", async ({
  page,
}) => {
  const errors: string[] = [];
  const failures: string[] = [];
  const unexpected: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("requestfailed", (r) => failures.push(r.url()));
  page.on("request", (r) => {
    if (r.method() !== "GET" || new URL(r.url()).hostname !== "127.0.0.1")
      unexpected.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/preview/operacao");
  await expect(
    page.getByRole("heading", { name: "Central de operações" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Novo pedido", exact: true });
  await expect(
    form.getByLabel("Nome do cliente", { exact: true }),
  ).toBeFocused();
  await form
    .getByLabel("Nome do cliente", { exact: true })
    .fill("Cliente fictício de teste");
  await form.getByLabel("WhatsApp", { exact: true }).fill("(11) 90000-0000");
  await form.getByLabel("Endereço", { exact: true }).fill("Rua fictícia, 99");
  await form.getByLabel("Bairro", { exact: true }).fill("Centro");
  await form
    .getByLabel("Complemento / referência", { exact: true })
    .fill("Portaria azul");
  await form
    .getByLabel("Observações", { exact: true })
    .fill("Conferir embalagem");
  await form.getByRole("button", { name: "Cadastrar pedido (demo)" }).click();
  await expect(form).not.toBeVisible();
  for (const ref of ["1049", "1048", "1047"])
    await page
      .getByRole("checkbox", { name: `Selecionar pedido ${ref}`, exact: true })
      .check();
  if (await page.getByRole("tab", { name: /^Montagem/ }).isVisible())
    await page.getByRole("tab", { name: /^Montagem/ }).click();
  await page
    .getByRole("button", { name: "Mover pedido 1049 para baixo" })
    .click();
  await expect(page.getByLabel("Motoboy disponível")).toHaveValue("joao");
  await page.getByRole("button", { name: "Atribuir rota (demo)" }).click();
  if (await page.getByRole("tab", { name: "Rotas", exact: true }).isVisible())
    await expect(
      page.getByRole("tab", { name: "Rotas", exact: true }),
    ).toBeFocused();
  const created = route(page, "R-43");
  await expect(created).toContainText("Em preparação");
  await expect(created.getByRole("listitem").first()).toContainText("1048");
  await expect(
    created.getByRole("button", { name: /Iniciar rota/ }),
  ).toHaveCount(0);
  await area(page, "Motoboys");
  const joao = page.locator(".ops-courier").filter({ hasText: "João Martins" });
  await expect(joao).toContainText("Reservado");
  await expect(page.locator(".ops-courier.is-next")).toContainText(
    "Lívia Oliveira",
  );
  await area(page, "Rotas");
  await created.getByRole("button", { name: "Editar montagem" }).click();
  if (await page.getByRole("tab", { name: /^Montagem/ }).isVisible())
    await expect(page.getByRole("tab", { name: /^Montagem/ })).toBeFocused();
  await page
    .getByRole("button", { name: "Remover pedido 1047 da montagem" })
    .click();
  await page.getByRole("button", { name: "Salvar montagem (demo)" }).click();
  await expect(created.getByRole("listitem")).toHaveCount(2);
  await created
    .getByRole("button", { name: "Visão do motoboy (demo)" })
    .click();
  const driver = page.getByRole("dialog", { name: "Aplicativo do motoboy" });
  await expect(driver).toContainText("Cliente fictício de teste");
  await expect(driver).toContainText("Portaria azul");
  await driver
    .getByRole("button", { name: "Iniciar rota — simulação" })
    .click();
  await expect(driver).toContainText("Em rota");
  await expect(
    driver.getByRole("button", { name: "Simular entregas concluídas" }),
  ).toBeFocused();
  await expect(
    created.getByRole("button", { name: "Editar montagem" }),
  ).toHaveCount(0);
  await driver
    .getByRole("button", { name: "Simular entregas concluídas" })
    .click();
  await expect(driver).toContainText("Retornando");
  await expect(
    driver.getByRole("button", { name: "Confirmar retorno — simulação" }),
  ).toBeFocused();
  await driver
    .getByRole("button", { name: "Confirmar retorno — simulação" })
    .click();
  await expect(driver).toContainText("final da fila");
  await expect(
    driver.getByRole("button", { name: "Fechar visão do motoboy" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(created).toContainText("Concluída");
  await area(page, "Montagem");
  await expect(
    page.getByLabel("Motoboy disponível").getByRole("option"),
  ).toHaveText([
    "Lívia Oliveira · próximo da fila",
    "Bianca Souza",
    "João Martins",
  ]);
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Selecionar pedido 1049", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  expect(unexpected).toEqual([]);
});

test("PREPARING pode ajustar composição; ocorrência em ON_ROUTE exige decisão da loja", async ({
  page,
}) => {
  await page.goto("/preview/operacao");
  await area(page, "Rotas");
  await route(page, "R-42")
    .getByRole("button", { name: "Editar montagem" })
    .click();
  await page
    .getByRole("button", { name: "Remover pedido 1042 da montagem" })
    .click();
  await area(page, "Pedidos");
  await page
    .getByRole("checkbox", { name: "Selecionar pedido 1048", exact: true })
    .check();
  if (await page.getByRole("tab", { name: /^Montagem/ }).isVisible())
    await page.getByRole("tab", { name: /^Montagem/ }).click();
  await page
    .getByRole("button", { name: "Mover pedido 1048 para cima" })
    .click();
  await expect(page.getByLabel("Motoboy reservado")).toBeDisabled();
  await page.getByRole("button", { name: "Salvar montagem (demo)" }).click();
  await expect(route(page, "R-42").getByRole("listitem")).toHaveText([
    "#1048 · Vila Mariana",
    "#1041 · Bela Vista",
  ]);
  await expect(
    route(page, "R-41").getByRole("button", { name: "Editar montagem" }),
  ).toHaveCount(0);
  await page.getByText("Ocorrência · #1039", { exact: true }).click();
  await expect(
    page.getByText("A decisão da loja será implementada", { exact: false }),
  ).toBeVisible();
  await route(page, "R-41")
    .getByRole("button", { name: "Visão do motoboy (demo)" })
    .click();
  await expect(
    page.getByRole("button", { name: "Simular entregas concluídas" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await area(page, "Pedidos");
  await expect(
    page.getByRole("checkbox", { name: "Selecionar pedido 1042", exact: true }),
  ).not.toBeChecked();
});

test("busca, filtros e seleção em pico ficam limitados à página visível", async ({
  page,
}) => {
  await page.goto("/preview/operacao?scenario=busy");
  const orders = page.locator("#ops-panel-orders");
  await expect(orders.locator(".ops-order")).toHaveCount(20);
  await page.getByRole("checkbox", { name: "Selecionar visíveis" }).check();
  await expect(orders).toContainText("20 selecionados");
  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Selecionar visíveis" }),
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Selecionar visíveis" }).check();
  await expect(orders).toContainText("40 selecionados");
  await page.getByLabel("Buscar pedidos").fill("não existe esse cliente");
  await expect(
    page.getByText("Nenhum resultado", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Selecionar visíveis" }),
  ).toBeDisabled();
  await page.getByLabel("Buscar pedidos").fill("Centro");
  await page.getByLabel("Com observação").check();
  await expect(orders.locator(".ops-order").first()).toContainText(
    "Conferir referência",
  );
  await page.reload();
  await expect(page.getByLabel("Cenário")).toHaveValue("busy");
  await expect(orders).toContainText("0 selecionados");
});

test("reflow em 320/375/390, 1280/1440 e tela ampla suporta textos extremos", async ({
  page,
}) => {
  for (const width of [320, 375, 390, 640, 1280, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/preview/operacao?scenario=worst");
    await expect(
      page.getByText("Maria Aparecida de Albuquerque e Vasconcelos", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .locator(".ops-order-note")
        .filter({ hasText: "<b>Sem talheres</b>" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width >= 1100) {
      await expect(page.getByRole("tabpanel")).toHaveCount(4);
      await expect(
        page.getByRole("heading", { name: "Montagem de rota" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Motoboys", exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.getByRole("tabpanel")).toHaveCount(1);
      await page.getByRole("tab", { name: "Pedidos", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByRole("tab", { name: "Montagem", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("heading", { name: "Montagem de rota" }),
      ).toBeVisible();
    }
  }
});

test("vazio, um pedido e modal com teclado oferecem caminhos claros", async ({
  page,
}) => {
  await page.goto("/preview/operacao?scenario=empty");
  await expect(
    page.getByText("Nenhum pedido aguardando", { exact: true }),
  ).toBeVisible();
  await area(page, "Montagem");
  await expect(
    page.getByRole("button", { name: "Atribuir rota (demo)" }),
  ).toBeDisabled();
  await area(page, "Motoboys");
  await expect(
    page.getByText("Nenhum motoboy no turno", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo pedido", exact: true });
  await dialog.getByLabel("Nome do cliente", { exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Fechar novo pedido" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Novo pedido", exact: true }),
  ).toBeFocused();
  await page.getByLabel("Cenário").selectOption("one");
  await expect(page.getByLabel("Cenário")).toBeFocused();
  await expect(
    page.getByRole("checkbox", { name: "Selecionar pedido 1048", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ops-order")).toHaveCount(1);
});

test("dashboard preserva acesso e não envia operações ao Supabase", async ({
  page,
}) => {
  const calls = await mockSupabase(page, { existing: true });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("operador@example.test");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Test-only-password-123!");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(
    page.getByRole("heading", { name: "Central de operações" }),
  ).toBeVisible();
  await expect(page.getByLabel("Cenário")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Selecionar pedido 1048", exact: true })
    .check();
  if (await page.getByRole("tab", { name: /^Montagem/ }).isVisible())
    await page.getByRole("tab", { name: /^Montagem/ }).click();
  await page.getByRole("button", { name: "Atribuir rota (demo)" }).click();
  await expect(route(page, "R-43")).toBeVisible();
  expect(calls.rpc).toEqual([]);
  expect(calls.unexpected).toEqual([]);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("cadastro valida campos vazios e celular sem perder os dados preenchidos", async ({
  page,
}) => {
  await page.goto("/preview/operacao");
  await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo pedido", exact: true });
  await dialog.getByLabel("Nome do cliente", { exact: true }).fill("   ");
  await dialog.getByLabel("WhatsApp", { exact: true }).fill("1234");
  await dialog.getByLabel("Endereço", { exact: true }).fill("Rua fictícia, 17");
  await dialog.getByLabel("Bairro", { exact: true }).fill("Centro");
  await dialog.getByRole("button", { name: "Cadastrar pedido (demo)" }).click();
  await expect(
    dialog.getByLabel("Nome do cliente", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel("Nome do cliente", { exact: true })
    .fill("Cliente de demonstração");
  await dialog.getByRole("button", { name: "Cadastrar pedido (demo)" }).click();
  await expect(dialog.getByLabel("WhatsApp", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("Endereço", { exact: true })).toHaveValue(
    "Rua fictícia, 17",
  );
  await dialog.getByLabel("WhatsApp", { exact: true }).fill("(11) 90000-0000");
  await dialog.getByLabel("Número / referência (opcional)").fill("BALCAO-X1");
  await dialog.getByRole("button", { name: "Cadastrar pedido (demo)" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "Selecionar pedido BALCAO-X1",
      exact: true,
    }),
  ).toBeVisible();
});
