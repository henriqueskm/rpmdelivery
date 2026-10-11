import { expect, type Page } from "@playwright/test";
import { testRestaurant } from "./supabase";

export const resolvedAddress = {
  address: testRestaurant.address, latitude: -23.55, longitude: -46.63,
  provider: "mapbox", providerId: "mapbox_test_id",
};
export const geoPayload = {
  p_address: resolvedAddress.address, p_latitude: resolvedAddress.latitude,
  p_longitude: resolvedAddress.longitude, p_address_provider: resolvedAddress.provider,
  p_address_provider_id: resolvedAddress.providerId, p_phone: null,
};

export async function mockGeocoding(page: Page, options: {
  empty?: boolean; error?: boolean; resolveError?: boolean; slow?: boolean; many?: boolean;
} = {}) {
  const calls: { suggest: string[]; resolve: string[] } = { suggest: [], resolve: [] };
  await page.route("**/api/geocoding/*", async (route) => {
    const resolve = route.request().url().endsWith("/resolve");
    const body = route.request().postDataJSON();
    if (resolve) calls.resolve.push(body.mapboxId);
    else calls.suggest.push(body.query);
    if (options.slow) await new Promise((done) => setTimeout(done, 650));
    await route.fulfill({ status: options.error || (resolve && options.resolveError) ? 502 : 200,
      json: options.error || (resolve && options.resolveError) ? { message: "Falha simulada" }
        : resolve ? resolvedAddress : options.empty ? []
          : Array.from({ length: options.many ? 8 : 1 }, (_, i) => ({
            id: i ? `mapbox_test_${i}` : resolvedAddress.providerId,
            label: i ? `Rua de teste, ${i}` : "Rua das Flores, 120",
            secondaryLabel: "São Paulo, Brasil",
          })),
    });
  });
  // Diagnostic-only image fixture; no real Mapbox request or public token.
  await page.route("https://api.mapbox.com/**", (route) => route.fulfill({
    contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect width="600" height="240" fill="#ecf1e7"/><path d="M0 100H600M260 0V240" stroke="#cbd2c8" stroke-width="24"/><circle cx="300" cy="120" r="12" fill="#bd401b"/><text x="8" y="232" font-size="12">Mapbox · Mapa simulado para testes</text></svg>',
  }));
  return calls;
}

export async function selectAddress(page: Page) {
  await page.getByRole("combobox", { name: "Endereço", exact: true }).fill("Rua das Flores, 120");
  await page.getByRole("option", { name: "Rua das Flores, 120 São Paulo, Brasil" }).click();
  await expect(page.getByText("✓ Endereço confirmado", { exact: true })).toBeVisible();
}

export async function enterOnboarding(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill("operador@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("Test-only-password-123!");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(page.getByLabel("Nome do restaurante")).toBeVisible();
  await page.getByLabel("Nome do restaurante").fill(testRestaurant.name);
}
