import { expect, test } from "@playwright/test";

test("smoke: a página inicial carrega sem erros críticos básicos", async ({
  page,
  baseURL,
}) => {
  const runtimeErrors: string[] = [];
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];
  const appOrigin = new URL(baseURL!).origin;

  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (new URL(response.url()).origin === appOrigin && response.status() >= 400) {
      networkErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === appOrigin) {
      networkErrors.push(`${request.failure()?.errorText} ${request.url()}`);
    }
  });

  const response = await page.goto("/", { waitUntil: "load" });

  expect(response?.status(), "A página inicial deve responder HTTP 200").toBe(200);
  await expect(page).toHaveTitle("RpmDelivery");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bom ter você aqui.", level: 1, exact: true }),
  ).toBeVisible();

  expect(runtimeErrors, "Exceções JavaScript não tratadas").toEqual([]);
  expect(consoleErrors, "Erros de console durante o carregamento").toEqual([]);
  expect(networkErrors, "Falhas HTTP ou de rede da aplicação local").toEqual([]);
});
