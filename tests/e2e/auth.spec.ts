import { expect, test, type Page } from "@playwright/test";
import { mockSupabase, testRestaurant } from "./support/supabase";
import { mockGeocoding, selectAddress, geoPayload } from "./support/geocoding";

async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("operador@example.test");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Test-only-password-123!");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
}

async function fillSignup(page: Page) {
  await page.getByLabel("Seu nome").fill("Operador de teste");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("operador@example.test");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Test-only-password-123!");
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("Test-only-password-123!");
}

test("login → onboarding → RPC → dashboard → sair, sem erros inesperados", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  const calls = await mockSupabase(page, { slow: true });
  await mockGeocoding(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Criar conta", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Entre no ritmo." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Entrar", exact: true }).click();
  await login(page);
  await expect(page.getByRole("button", { name: "Entrando…" })).toBeDisabled();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Vamos dar nome à sua operação." }),
  ).toBeVisible();
  await page.getByLabel("Nome do restaurante").fill(testRestaurant.name);
  await selectAddress(page);
  await page.getByRole("button", { name: "Preparar meu restaurante" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Central de operações" }),
  ).toBeVisible();
  await expect(
    page.getByText("Demonstração com dados fictícios.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Aguardando despacho" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Central de operações" }),
  ).toBeVisible();
  expect(calls.rpc).toEqual([
    { p_name: testRestaurant.name, ...geoPayload },
  ]);
  expect(calls.unexpected).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("cadastro exige senhas iguais e confirmação de e-mail sem liberar dashboard", async ({
  page,
}) => {
  await mockSupabase(page);
  await page.goto("/cadastro");
  await fillSignup(page);
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("Different-password-123!");
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "As senhas precisam ser iguais.",
  );
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("Test-only-password-123!");
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(
    page.getByRole("heading", { name: "Confira seu e-mail" }),
  ).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("cadastro com sessão válida segue para onboarding", async ({ page }) => {
  await mockSupabase(page, { signupSession: true });
  await page.goto("/cadastro");
  await fillSignup(page);
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(page.getByLabel("Nome do restaurante")).toBeVisible();
});

test("membro existente vai direto ao dashboard sem criar restaurante", async ({
  page,
}) => {
  const calls = await mockSupabase(page, { existing: true });
  await login(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByText(testRestaurant.name, { exact: true }),
  ).toBeVisible();
  expect(calls.rpc).toEqual([]);
});

test("login inválido apresenta mensagem amigável e permite tentar novamente", async ({
  page,
}) => {
  await mockSupabase(page, { invalidLogin: true });
  await login(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "E-mail ou senha incorretos",
  );
  await expect(
    page.getByRole("button", { name: "Entrar na minha conta" }),
  ).toBeEnabled();
  await expect(page).toHaveURL(/\/login$/);
});

test("falha de consulta não é interpretada como restaurante ausente", async ({
  page,
}) => {
  const calls = await mockSupabase(page, { queryError: true });
  await login(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Não foi possível consultar seu restaurante",
  );
  await expect(page.getByLabel("Nome do restaurante")).toHaveCount(0);
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  expect(calls.rpc).toEqual([]);
});

test("resultado incerto do RPC bloqueia reenvio e oferece conferir vínculo", async ({
  page,
}) => {
  const calls = await mockSupabase(page, { rpcError: true });
  await mockGeocoding(page);
  await login(page);
  await page.getByLabel("Nome do restaurante").fill(testRestaurant.name);
  await selectAddress(page);
  await page.getByRole("button", { name: "Preparar meu restaurante" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Não foi possível confirmar a criação",
  );
  await expect(
    page.getByRole("button", { name: "Preparar meu restaurante" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Conferir meu vínculo" }).click();
  await expect(page.getByLabel("Nome do restaurante")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preparar meu restaurante" }),
  ).toBeDisabled();
  expect(calls.rpc).toHaveLength(1);
});

test("rota autenticada sem sessão volta ao login", async ({ page }) => {
  await mockSupabase(page);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/login$/);
});
