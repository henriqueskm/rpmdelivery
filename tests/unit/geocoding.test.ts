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
    assert.deepEqual(Object.keys(suggestions[0]).sort(), ["id", "kind", "label", "secondaryLabel"]);
    assert.equal(suggestions[0].kind, "address");
    const resolved = await mapboxProvider.resolve(suggestions[0].id);
    assert.equal(resolved.latitude, -23.55);
    assert.equal(resolved.providerId, suggestions[0].id);
    for (const request of requests) {
      assert.equal(request.searchParams.get("country"), "br");
      assert.equal(request.searchParams.get("language"), "pt");
      assert.equal(request.searchParams.has("proximity"), false);
    }
    assert.equal(requests[0].searchParams.get("types"), "address,street");
    assert.equal(requests[1].searchParams.get("types"), "address");
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

test("rua sem número vira sugestão de rua; a loja puxa a busca para a sua cidade", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.MAPBOX_ACCESS_TOKEN;
  process.env.MAPBOX_ACCESS_TOKEN = "server-test-placeholder";
  let request: URL | undefined;
  globalThis.fetch = async (input) => {
    request = new URL(String(input));
    const street = feature("street_id");
    street.properties.feature_type = "street";
    street.properties.name = "Rua Jovino Antônio Santana";
    return Response.json({ features: [street, { properties: { ...feature().properties, feature_type: "place" } }] });
  };
  try {
    const suggestions = await mapboxProvider.suggest("Rua Jovino", undefined, { latitude: -23.0, longitude: -46.84 });
    assert.deepEqual(suggestions.map(s => [s.kind, s.label]), [["street", "Rua Jovino Antônio Santana"]]);
    assert.equal(request?.searchParams.get("proximity"), "-46.84,-23");
    // A street alone never confirms: resolve searches addresses only and finds nothing.
    await assert.rejects(mapboxProvider.resolve("street_id"), /Endereço não confirmado/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.MAPBOX_ACCESS_TOKEN;
    else process.env.MAPBOX_ACCESS_TOKEN = originalToken;
  }
});

test("bairro: do Mapbox, senão pelo CEP, senão pela rua no ViaCEP; falha deixa em branco", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.MAPBOX_ACCESS_TOKEN;
  process.env.MAPBOX_ACCESS_TOKEN = "server-test-placeholder";
  const viaCep: string[] = [];
  const withContext = (context: object) => async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://viacep.com.br/")) {
      viaCep.push(decodeURIComponent(url));
      if (url.includes("/13254270/")) return Response.json({ cep: "13254-270", bairro: "Parque São Francisco" });
      if (url.includes("/SP/Itatiba/")) return Response.json([{ bairro: "Parque São Francisco" }, { bairro: "Parque São Francisco" }]);
      if (url.includes("/SP/Campinas/")) return Response.json([{ bairro: "Centro" }, { bairro: "Cambuí" }]);
      return new Response("", { status: 400 });
    }
    const item = feature();
    Object.assign(item.properties.context, context);
    return Response.json({ features: [item] });
  };
  const street = { region: { region_code: "SP" }, address: { street_name: "Rua Jovino Antônio Santana" } };
  try {
    globalThis.fetch = withContext({ neighborhood: { name: "Vila Mariana" } });
    assert.equal((await mapboxProvider.resolve("mapbox_test_id")).neighborhood, "Vila Mariana");
    assert.deepEqual(viaCep, []);
    globalThis.fetch = withContext({ postcode: { name: "13254-270" } });
    assert.equal((await mapboxProvider.resolve("mapbox_test_id")).neighborhood, "Parque São Francisco");
    globalThis.fetch = withContext({ postcode: { name: "13254" }, place: { name: "Itatiba" }, ...street });
    assert.equal((await mapboxProvider.resolve("mapbox_test_id")).neighborhood, "Parque São Francisco");
    assert.equal(viaCep.at(-1), "https://viacep.com.br/ws/SP/Itatiba/Rua Jovino Antônio Santana/json/");
    // A street across several bairros: the store picks.
    globalThis.fetch = withContext({ postcode: { name: "13000" }, place: { name: "Campinas" }, ...street });
    assert.equal((await mapboxProvider.resolve("mapbox_test_id")).neighborhood, undefined);
    globalThis.fetch = withContext({ postcode: { name: "99999-999" } });
    const resolved = await mapboxProvider.resolve("mapbox_test_id");
    assert.equal("neighborhood" in resolved, false);
    assert.equal(isResolvedAddress(resolved), true);
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
  assert.equal(isResolvedAddress({ ...address, neighborhood: "Centro" }), true);
  assert.equal(isResolvedAddress({ ...address, neighborhood: 12 }), false);
  assert.equal(isResolvedAddress({ ...address, neighborhood: "x".repeat(121) }), false);
});
