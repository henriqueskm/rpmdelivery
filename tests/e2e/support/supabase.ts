import type { Page } from "@playwright/test";

export const testUser = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "operador@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { name: "Operador de teste" },
  created_at: "2026-01-01T00:00:00Z",
};
export const testRestaurant = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Cozinha da Vila",
  address: "Rua das Flores, 120, São Paulo",
  phone: null,
};

type Options = {
  existing?: boolean;
  invalidLogin?: boolean;
  queryError?: boolean;
  rpcError?: boolean;
  signupSession?: boolean;
  slow?: boolean;
};

export async function mockSupabase(page: Page, options: Options = {}) {
  let existing = options.existing ?? false;
  const calls: { rpc: unknown[]; unexpected: string[] } = {
    rpc: [],
    unexpected: [],
  };
  const accessToken = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    Buffer.from(
      JSON.stringify({
        sub: testUser.id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: "authenticated",
      }),
    ).toString("base64url"),
    "fake-test-signature",
  ].join(".");
  const session = {
    access_token: accessToken,
    refresh_token: "fake-test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    user: testUser,
  };
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const reply = (json: unknown, status = 200) =>
      route.fulfill({
        status,
        json,
        headers: {
          "access-control-allow-origin": "*",
          "x-supabase-api-version": "2024-01-01",
          "access-control-expose-headers": "x-supabase-api-version",
        },
      });
    if (route.request().method() === "OPTIONS") {
      await reply({});
      return;
    }
    if (options.slow && path.startsWith("/auth/v1/token"))
      await new Promise((resolve) => setTimeout(resolve, 600));
    if (path === "/auth/v1/token") {
      await reply(
        options.invalidLogin
          ? { code: "invalid_credentials", msg: "Invalid login credentials" }
          : session,
        options.invalidLogin ? 400 : 200,
      );
    } else if (path === "/auth/v1/signup") {
      await reply(
        options.signupSession ? session : { ...testUser, identities: [] },
      );
    } else if (path === "/auth/v1/user") {
      await reply(testUser);
    } else if (path === "/auth/v1/logout") {
      await reply({});
    } else if (path === "/rest/v1/restaurant_members") {
      await reply(
        options.queryError
          ? { message: "test failure", code: "XX000" }
          : existing
            ? [{ restaurant_id: testRestaurant.id }]
            : [],
        options.queryError ? 500 : 200,
      );
    } else if (path === "/rest/v1/restaurants") {
      await reply(testRestaurant);
    } else if (path === "/rest/v1/rpc/create_restaurant") {
      calls.rpc.push(route.request().postDataJSON());
      if (!options.rpcError) existing = true;
      await reply(
        options.rpcError
          ? { message: "test failure", code: "XX000" }
          : testRestaurant.id,
        options.rpcError ? 500 : 200,
      );
    } else {
      calls.unexpected.push(path);
      await reply({ message: "Unexpected mock endpoint" }, 500);
    }
  });
  return calls;
}
