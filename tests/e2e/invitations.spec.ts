import { test, expect } from "@playwright/test";
import { mockInvitations, inviteCode } from "./support/invitations";
import { testUser } from "./support/supabase";
import { mkdirSync } from "node:fs";
async function login(page: import("@playwright/test").Page) {
  await page.getByLabel("E-mail", { exact: true }).fill("courier@fixture.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("local-fixture-password");
  await page.getByRole("button", { name: "Entrar na minha conta", exact: true }).click();
}
test("link/QR → login → perfil → vínculo PENDING e várias lojas, sem restaurante", async ({ page }, testInfo) => {
  const { calls, base } = await mockInvitations(page);
  const leaks: string[] = [];
  page.on("request", request => { if (request.url().includes(inviteCode)) leaks.push(request.url()); });
  await page.goto("/convite#c=" + inviteCode);
  await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await page.getByRole("link", { name: "Entrar", exact: true }).click();
  await login(page);
  await expect(page.getByRole("form", { name: "Cadastro de motoboy" })).toBeVisible();
  mkdirSync("docs/screenshots/courier-invitations", { recursive: true });
  await page.screenshot({ path: `docs/screenshots/courier-invitations/${testInfo.project.name}-profile.png`, fullPage: true });
  await page.getByLabel("Seu nome", { exact: true }).fill("Motoboy de teste");
  await page.getByLabel("Modelo da moto", { exact: true }).fill("CG 160");
  await page.getByLabel("Placa", { exact: true }).fill("ABC1D23");
  await page.getByLabel("Cor da moto", { exact: true }).fill("Preta");
  await page.getByLabel("Celular com DDD (opcional)", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Salvar cadastro de motoboy", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Informe um celular com DDD");
  expect(calls.filter(call => call.name === "complete_courier_registration")).toHaveLength(0);
  await page.getByLabel("Celular com DDD (opcional)", { exact: true }).fill("(11) 99999-9999");
  await page.getByRole("button", { name: "Salvar cadastro de motoboy", exact: true }).click();
  await page.getByRole("button", { name: "Solicitar vínculo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Solicitação enviada" })).toBeVisible();
  await page.getByRole("link", { name: "Ver meus estabelecimentos" }).click();
  await expect(page.getByRole("heading", { name: "Meus estabelecimentos" })).toBeVisible();
  await expect(page.getByText("Pendente", { exact: true })).toBeVisible();
  await expect(page.getByText("Aprovado", { exact: true })).toBeVisible();
  expect(base.rpc).toEqual([]); expect(leaks).toEqual([]);
  expect(calls.find(call => call.name === "request_courier_membership")?.body).toEqual({ p_code: inviteCode });
});

test("nomes e modelos longos preservam aprovação e leitura em 320/375/390", async ({ page }, testInfo) => {
  await mockInvitations(page, { longText: true });
  await page.goto("/login"); await login(page);
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/motoboys");
    await expect(page.getByRole("button", { name: "Aprovar", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 375) {
      mkdirSync("docs/screenshots/courier-invitations", { recursive: true });
      await page.screenshot({ path: `docs/screenshots/courier-invitations/${testInfo.project.name}-long-375.png`, fullPage: true });
    }
  }
});
test("cadastro sem sessão preserva convite na confirmação e na sessão confirmada", async ({ page }) => {
  const { base } = await mockInvitations(page, { existingProfile: true });
  const redirects: string[] = [];
  page.on("request", request => { if (request.url().includes("/signup")) redirects.push(request.url()); });
  await page.goto("/convite#c=" + inviteCode);
  await page.getByRole("link", { name: "Criar conta de motoboy" }).click();
  await page.getByLabel("Seu nome", { exact: true }).fill("Motoboy fixture");
  await page.getByLabel("E-mail", { exact: true }).fill("courier@fixture.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("local-fixture-password");
  await page.getByLabel("Confirmar senha", { exact: true }).fill("local-fixture-password");
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(page.getByRole("heading", { name: "Confira seu e-mail" })).toBeVisible();
  expect(redirects.length).toBe(1);
  expect(decodeURIComponent(redirects[0])).toContain("/convite");
  expect(redirects[0]).not.toContain(inviteCode);
  const jwt = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", Buffer.from(JSON.stringify({ sub: testUser.id, exp: Math.floor(Date.now()/1000)+3600, role: "authenticated" })).toString("base64url"),"fake-signature"].join(".");
  await page.goto("/convite#access_token=" + jwt + "&refresh_token=fake-confirmed-refresh&token_type=bearer&expires_in=3600&type=signup");
  await expect(page.getByRole("button", { name: "Solicitar vínculo", exact: true })).toBeVisible();
  expect(base.rpc).toEqual([]);
});
test("código manual, convite indisponível e navegação mobile não criam restaurante", async ({ page }) => {
  const { base } = await mockInvitations(page, { unavailable: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/convite");
  await page.getByLabel("Código do convite", { exact: true }).fill("ABCD-EF12-3456-7890-ABCD");
  await page.getByRole("button", { name: "Continuar com o código" }).click();
  await page.getByRole("link", { name: "Entrar", exact: true }).click(); await login(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Convite indisponível");
  await expect(page.getByRole("button", { name: "Solicitar vínculo", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(base.rpc).toEqual([]);
});
test("OWNER/MANAGER gera QR/código, aprova e revoga; OPERATOR é bloqueado", async ({ page }) => {
  const { calls, restaurantId } = await mockInvitations(page);
  await page.goto("/login"); await login(page);
  await page.goto("/motoboys");
  await page.getByRole("button", { name: "Gerar convite", exact: true }).click();
  await page.getByRole("button", { name: "Exibir convite", exact: true }).click();
  await expect(page.getByRole("img", { name: "QR Code do convite" })).toBeVisible();
  await expect(page.getByText("ABCD-EF12-3456-7890-ABCD", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Aprovar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Vínculo aprovado");
  await page.getByRole("button", { name: "Revogar convite", exact: true }).click();
  await expect(page.getByText("Revogado", { exact: true })).toBeVisible();
  expect(calls.find(call => call.name === "review_courier_membership")?.body).toEqual({ p_restaurant_id: restaurantId, p_relationship_id: "44444444-4444-4444-8444-444444444444", p_approve: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("OPERATOR não recebe controles de gestão", async ({ page }) => {
  await mockInvitations(page, { operator: true });
  await page.goto("/login"); await login(page); await page.goto("/motoboys");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Somente proprietários e gerentes");
  await expect(page.getByRole("button", { name: "Gerar convite", exact: true })).toHaveCount(0);
});

for (const legacyProfile of ["empty", "partial"] as const) {
  test(`cadastro antigo ${legacyProfile}: bloqueia contorno e completa apenas campos faltantes`, async ({ page }, testInfo) => {
    const { calls, base } = await mockInvitations(page, { legacyProfile });
    await page.setViewportSize({ width: testInfo.project.name === "mobile-chromium" ? 390 : 1280, height: 844 });
    await page.goto("/convite#c=" + inviteCode);
    await page.getByRole("link", { name: "Entrar", exact: true }).click(); await login(page);
    await expect(page.getByRole("form", { name: "Cadastro de motoboy" })).toBeVisible();
    await expect(page.getByLabel("Seu nome", { exact: true })).toHaveValue("Nome já cadastrado");
    await expect(page.getByLabel("Seu nome", { exact: true })).toHaveAttribute("readonly");
    await expect(page.getByLabel("Seu nome", { exact: true })).toHaveAccessibleDescription("Já salvo · somente leitura");
    await expect(page.getByRole("button", { name: "Solicitar vínculo", exact: true })).toHaveCount(0);
    // Mocked HTTP contract; actual authorization/mandatory-field enforcement is
    // exercised separately with real PostgreSQL roles, not inferred from this mock.
    const bypass = await page.evaluate(async code => {
      const response = await fetch("http://127.0.0.1:54321/rest/v1/rpc/request_courier_membership", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_code: code }),
      }); return response.json();
    }, inviteCode);
    expect(bypass).toEqual({ ok: false, reason: "profile_required" });
    mkdirSync("docs/screenshots/courier-invitations", { recursive: true });
    await page.screenshot({ path: `docs/screenshots/courier-invitations/${testInfo.project.name}-legacy-${legacyProfile}.png`, fullPage: true });
    if (legacyProfile === "partial") {
      await expect(page.getByLabel("Modelo da moto", { exact: true })).toHaveValue("Honda CG 160");
      await expect(page.getByLabel("Modelo da moto", { exact: true })).toHaveAttribute("readonly");
      await expect(page.getByLabel("Modelo da moto", { exact: true })).toHaveAccessibleDescription("Já salvo · somente leitura");
      await expect(page.getByLabel("Cor da moto", { exact: true })).toHaveValue("Preta");
    } else {
      await page.getByLabel("Modelo da moto", { exact: true }).fill("Modelo preenchido");
      await page.getByLabel("Cor da moto", { exact: true }).fill("Azul");
    }
    await page.getByLabel("Placa", { exact: true }).fill("abc1d23");
    const reinspection = page.waitForResponse(response => response.url().endsWith("/rpc/inspect_courier_invite"));
    await page.getByRole("button", { name: "Salvar cadastro de motoboy", exact: true }).click();
    const repaired = await (await reinspection).json();
    expect(repaired.registered).toBe(true);
    expect(repaired.profile.name).toBe("Nome já cadastrado");
    expect(repaired.profile.plate).toBe("ABC1D23");
    if (legacyProfile === "partial") expect(repaired.profile.model).toBe("Honda CG 160");
    await page.getByRole("button", { name: "Solicitar vínculo", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Solicitação enviada" })).toBeVisible();
    expect(calls.filter(call => call.name === "complete_courier_registration")).toHaveLength(1);
    expect(base.rpc).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("solicitação revalida cadastro e retorna ao reparo quando os dados ficam incompletos", async ({ page }) => {
  await mockInvitations(page, { existingProfile: true, incompleteAtRequest: true });
  await page.goto("/convite#c=" + inviteCode);
  await page.getByRole("link", { name: "Entrar", exact: true }).click(); await login(page);
  await page.getByRole("button", { name: "Solicitar vínculo", exact: true }).click();
  await expect(page.getByRole("form", { name: "Cadastro de motoboy" })).toBeVisible();
  await expect(page.getByLabel("Placa", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Solicitar vínculo", exact: true })).toHaveCount(0);
  await page.getByLabel("Placa", { exact: true }).fill("XYZ1A23");
  await page.getByRole("button", { name: "Salvar cadastro de motoboy", exact: true }).click();
  await page.getByRole("button", { name: "Solicitar vínculo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Solicitação enviada" })).toBeVisible();
});
test("gestão e convite mantêm ordem de foco, toque, reflow e evidências em desktop/mobile", async ({ page }, testInfo) => {
  mkdirSync("docs/screenshots/courier-invitations", { recursive: true });
  await mockInvitations(page, { existingProfile: true });
  await page.goto("/login"); await login(page);
  for (const width of [320, 375, 390, 1280, 1440]) {
    await page.setViewportSize({ width, height: width > 1000 ? 800 : 844 });
    await page.goto("/motoboys");
    await expect(page.getByRole("heading", { name: "Motoboys e convites" })).toBeVisible();
    await page.getByRole("button", { name: "Aprovar", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Rejeitar", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Atualizar solicitações", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Validade (horas)", { exact: true })).toBeFocused();
    if (width === 320) {
      await page.getByRole("button", { name: "Gerar convite", exact: true }).click();
    }
    if (width === 390 || width === 1280) {
      await page.getByRole("button", { name: "Exibir convite", exact: true }).click();
      await expect(page.getByRole("img", { name: "QR Code do convite" })).toBeVisible();
      await page.screenshot({ path: `docs/screenshots/courier-invitations/${testInfo.project.name}-management-${width}.png`, fullPage: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await page.getByRole("button").all()) {
      if (await button.isVisible()) expect(await button.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/convite#c=" + inviteCode);
  await expect(page.getByRole("button", { name: "Solicitar vínculo", exact: true })).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/courier-invitations/${testInfo.project.name}-courier-390.png`, fullPage: true });
});
