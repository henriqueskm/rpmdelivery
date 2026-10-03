import { test } from "node:test";
import assert from "node:assert/strict";
import { mapboxProvider } from "../../services/geocoding/mapbox-provider.ts";
import { isResolvedAddress } from "../../services/geocoding/types.ts";

const feature = (id = "mapbox_test_id") => ({ properties: {
  feature_type: "address", mapbox_id: id, name: "Rua das Flores, 120",
  full_address: "Rua das Flores, 120, São Paulo", place_formatted: "São Paulo, Brasil",
  context: { country: { country_code: "BR" } },
  coordinates: { latitude: -23.55, longitude: -46.63 },
} });

test("temporário retorna somente sugestões; permanente refaz busca por ID", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.MAPBOX_ACCESS_TOKEN;
  const requests: URL[] = [];
  process.env.MAPBOX_ACCESS_TOKEN = "server-test-placeholder";
  globalThis.fetch = async (input, options) => {
    requests.push(new URL(String(input)));
    assert.equal(options?.cache, "no-store");
    assert.ok(options?.signal);
    return Response.json({ features: Array.from({ length: 7 }, () => feature()) });
  };
  try {
    const suggestions = await mapboxProvider.suggest("Rua das Flores");
    assert.equal(suggestions.length, 5);
    assert.deepEqual(Object.keys(suggestions[0]).sort(), ["id", "label", "secondaryLabel"]);
    const resolved = await mapboxProvider.resolve(suggestions[0].id);
    assert.equal(resolved.latitude, -23.55);
    assert.equal(resolved.providerId, suggestions[0].id);
    for (const request of requests) {
      assert.equal(request.searchParams.get("country"), "br");
      assert.equal(request.searchParams.get("language"), "pt");
      assert.equal(request.searchParams.get("types"), "address");
    }
    assert.equal(requests[0].searchParams.get("permanent"), "false");
    assert.equal(requests[0].searchParams.get("autocomplete"), "true");
    assert.equal(requests[1].searchParams.get("permanent"), "true");
    assert.equal(requests[1].searchParams.get("autocomplete"), "false");
    assert.equal(requests[1].searchParams.get("q"), suggestions[0].id);
    globalThis.fetch = async () => Response.json({ private_detail: "must not leak" }, { status: 403 });
    await assert.rejects(mapboxProvider.resolve("mapbox_test_id"), /Geocoding indisponível/);
    globalThis.fetch = async () => Response.json({ features: [feature("another_id")] });
    await assert.rejects(mapboxProvider.resolve("mapbox_test_id"), /Endereço não confirmado/);
    globalThis.fetch = async () => Response.json({ features: [] });
    assert.deepEqual(await mapboxProvider.suggest("Rua sem resultado"), []);
    await assert.rejects(mapboxProvider.resolve("mapbox_test_id"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.MAPBOX_ACCESS_TOKEN;
    else process.env.MAPBOX_ACCESS_TOKEN = originalToken;
  }
});

test("endereço exige coordenadas finitas, limites e metadados", () => {
  const address = { address: "Rua das Flores", latitude: -23.55, longitude: -46.63,
    provider: "mapbox", providerId: "mapbox_test_id" };
  assert.equal(isResolvedAddress(address), true);
  for (const latitude of [null, undefined, NaN, Infinity, 91, -91])
    assert.equal(isResolvedAddress({ ...address, latitude }), false);
  assert.equal(isResolvedAddress({ ...address, longitude: 181 }), false);
  assert.equal(isResolvedAddress({ ...address, providerId: "" }), false);
});
