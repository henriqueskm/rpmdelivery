import { test } from "node:test";
import assert from "node:assert/strict";
import { handleGeocoding } from "../../lib/geocoding/handler.ts";

const request = (body: unknown, headers: Record<string, string> = {}) => new Request(
  "http://localhost/api/geocoding/suggest", { method: "POST",
      headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });

test("API limita input, tamanho, origem e exige identidade verificada", async () => {
  for (const query of ["ab", "x".repeat(201), 123, null])
    assert.equal((await handleGeocoding(request({ query }), "suggest")).status, 400);
  assert.equal((await handleGeocoding(request({ query: "Rua A" }), "suggest")).status, 401);
  assert.equal((await handleGeocoding(request({ mapboxId: "https://bad.invalid" }), "resolve")).status, 400);
  assert.equal((await handleGeocoding(request({ query: "Rua A" }, { origin: "https://evil.invalid" }), "suggest")).status, 403);
  assert.equal((await handleGeocoding(request({ query: "Rua A" }, { "content-type": "text/plain" }), "suggest")).status, 415);
  assert.equal((await handleGeocoding(request({ query: "x".repeat(3000) }), "suggest")).status, 413);
});

test("API verifica token no Auth e não retorna detalhes privados do upstream", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "MAPBOX_ACCESS_TOKEN"];
  const previous = keys.map((key) => process.env[key]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-test-placeholder";
  process.env.MAPBOX_ACCESS_TOKEN = "private-test-placeholder";
  let verified = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes("supabase.invalid")) {
      verified = true;
      return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
    }
    assert.equal(verified, true);
    return Response.json({ private_detail: "do not expose" }, { status: 403 });
  };
  try {
    const response = await handleGeocoding(request({ query: "Rua das Flores" }, {
      authorization: "Bearer fake.test.signature",
    }), "suggest");
    assert.equal(response.status, 502);
    assert.equal(verified, true);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { message: "Não foi possível buscar o endereço. Tente novamente." });
    globalThis.fetch = async () => Response.json({ message: "Invalid JWT" }, { status: 401 });
    assert.equal((await handleGeocoding(request({ query: "Rua das Flores" }, {
      authorization: "Bearer fake.test.signature",
    }), "suggest")).status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});
