import type { DemoState, DemoOrder } from "./model";
import { DEFAULT_PROMISE_MINUTES, DEMO_EPOCH, MINUTE } from "./deadlines.ts";
import { fixtureCoordinate } from "../route-optimization/fixtures.ts";

export const optimizationScenarios = [
  ["opt-short", "Otimização · rota curta"], ["opt-near", "Otimização · destinos próximos"],
  ["opt-urgent", "Otimização · urgente distante"], ["opt-tight", "Otimização · prazos próximos"],
  ["opt-impossible", "Otimização · prazos impossíveis"], ["opt-no-route", "Otimização · destino sem rota"],
  ["opt-unavailable", "Otimização · indisponível"], ["opt-missing", "Otimização · sem coordenadas"],
] as const;
export type Scenario = "demo" | "worst" | "empty" | "one" | "busy" | (typeof optimizationScenarios)[number][0];
const waiting = [
  [
    "1048",
    "Mariana Costa",
    "Vila Mariana",
    "Rua dos Ipês, 82",
    "Portaria recebe. Interfone 12.",
  ],
  [
    "1047",
    "Pedro Almeida",
    "Centro",
    "Rua das Acácias, 215",
    "Sem cebola. Conferir embalagem.",
  ],
  [
    "1046",
    "Beatriz Santos",
    "Jardim Paulista",
    "Alameda dos Girassóis, 41",
    "",
  ],
  [
    "1045",
    "Lucas Ferreira",
    "Vila Mariana",
    "Rua das Magnólias, 304",
    "Pagamento já confirmado pela loja.",
  ],
  ["1044", "Ana Ribeiro", "Bela Vista", "Rua dos Lírios, 96", ""],
  [
    "1043",
    "Rafael Lima",
    "Centro",
    "Praça das Flores, 18",
    "Entregar na recepção.",
  ],
];
function order(
  reference: string,
  customer: string,
  neighborhood: string,
  address: string,
  notes = "",
  waitMinutes = 12,
): DemoOrder {
  return {
    id: `demo-order-${reference}`,
    reference,
    customer,
    phone: "(11) 90000-0000",
    neighborhood,
    address,
    complement: "",
    notes,
    location: fixtureCoordinate(1 + (1048 - Number(reference) + 8000) % 8),
    orderedAt: DEMO_EPOCH - waitMinutes * MINUTE,
    createdAt: DEMO_EPOCH - waitMinutes * MINUTE,
    promisedMinutes: DEFAULT_PROMISE_MINUTES,
    status: "OPEN",
    delivery: "WAITING",
  };
}
export function createDemoState(scenario: Scenario = "demo", now = DEMO_EPOCH): DemoState {
  function anchored(value: DemoState): DemoState {
    const offset = now - DEMO_EPOCH;
    return { ...value,
      orders: value.orders.map(o => ({ ...o, orderedAt: o.orderedAt + offset, createdAt: o.createdAt + offset })),
      routes: value.routes.map(r => ({ ...r, pickupReleasedAt: r.pickupReleasedAt === null ? null : r.pickupReleasedAt + offset })),
    };
  }
  const orders = waiting.map((row, i) =>
    order(row[0], row[1], row[2], row[3], row[4], 6 + i * 4),
  );
  // Two orders were received before registration: near/overdue examples, no sorting.
  orders[1].orderedAt = DEMO_EPOCH - 52 * MINUTE;
  orders[2].orderedAt = DEMO_EPOCH - 68 * MINUTE;
  orders.push(
    {
      ...order("1042", "Camila Rocha", "Centro", "Rua das Oliveiras, 37"),
      delivery: "ASSIGNED",
    },
    {
      ...order("1041", "André Mendes", "Bela Vista", "Rua dos Cravos, 160"),
      delivery: "ASSIGNED",
    },
    {
      ...order(
        "1040",
        "Juliana Alves",
        "Jardim Paulista",
        "Rua dos Jacarandás, 72",
      ),
      status: "DELIVERING",
      delivery: "ON_ROUTE",
    },
    {
      ...order("1039", "Felipe Barros", "Centro", "Rua das Camélias, 290"),
      status: "DELIVERING",
      delivery: "ATTEMPT_FAILED",
      issue:
        "Cliente não localizado. Interfone sem resposta. A loja precisa decidir entre nova tentativa e retorno do pedido.",
    },
    {
      ...order("1038", "Carla Nunes", "Bela Vista", "Rua dos Hibiscos, 19"),
      status: "DELIVERED",
      delivery: "DELIVERED",
    },
    {
      ...order("1037", "Bruno Dias", "Centro", "Rua das Violetas, 52"),
      status: "DELIVERED",
      delivery: "DELIVERED",
    },
  );
  const state: DemoState = {
    restaurantLocation: fixtureCoordinate(0),
    defaultPromiseMinutes: DEFAULT_PROMISE_MINUTES,
    orders,
    nextOrder: 1049,
    nextRoute: 43,
    nextQueue: 4,
    couriers: [
      {
        id: "joao",
        name: "João Martins",
        initials: "JM",
        shift: "AVAILABLE",
        activeLink: true,
        queueOrder: 1,
        availableMinutes: 18,
      },
      {
        id: "livia",
        name: "Lívia Oliveira",
        initials: "LO",
        shift: "AVAILABLE",
        activeLink: true,
        queueOrder: 2,
        availableMinutes: 9,
      },
      {
        id: "bianca",
        name: "Bianca Souza",
        initials: "BS",
        shift: "AVAILABLE",
        activeLink: true,
        queueOrder: 3,
        availableMinutes: 3,
      },
      {
        id: "marcos",
        name: "Marcos Pereira",
        initials: "MP",
        shift: "AVAILABLE",
        activeLink: true,
        queueOrder: 0,
        availableMinutes: 0,
      },
      {
        id: "rafa",
        name: "Rafa Santos",
        initials: "RS",
        shift: "ON_ROUTE",
        activeLink: true,
        queueOrder: 0,
        availableMinutes: 0,
      },
      {
        id: "diego",
        name: "Diego Rocha",
        initials: "DR",
        shift: "RETURNING",
        activeLink: true,
        queueOrder: 0,
        availableMinutes: 0,
      },
      {
        id: "ana",
        name: "Ana Lima",
        initials: "AL",
        shift: "PENDING",
        activeLink: true,
        queueOrder: 0,
        availableMinutes: 0,
      },
    ],
    routes: [
      {
        id: "route-42",
        reference: "R-42",
        courierId: "marcos",
        orderIds: ["demo-order-1042", "demo-order-1041"],
        status: "PREPARING",
        pickupReleasedAt: null,
      },
      {
        id: "route-41",
        reference: "R-41",
        courierId: "rafa",
        orderIds: ["demo-order-1040", "demo-order-1039"],
        status: "ON_ROUTE",
        pickupReleasedAt: DEMO_EPOCH - 12 * MINUTE,
      },
      {
        id: "route-40",
        reference: "R-40",
        courierId: "diego",
        orderIds: ["demo-order-1038"],
        status: "RETURNING",
        pickupReleasedAt: DEMO_EPOCH - 45 * MINUTE,
      },
      {
        id: "route-39",
        reference: "R-39",
        courierId: "bianca",
        orderIds: ["demo-order-1037"],
        status: "COMPLETED",
        pickupReleasedAt: DEMO_EPOCH - 70 * MINUTE,
      },
    ],
  };
  if (scenario === "empty")
    return anchored({ ...state, orders: [], couriers: [], routes: [] });
  if (scenario === "one")
    return anchored({
      ...state,
      orders: [orders[0]],
      couriers: [state.couriers[0]],
      routes: [],
    });
  if (scenario === "worst") {
    state.orders[0] = {
      ...orders[0],
      customer: "Maria Aparecida de Albuquerque e Vasconcelos",
      neighborhood: "Residencial Parque dos Girassóis — Setor Norte",
      address:
        "Avenida Doutor Antônio de Oliveira e Silva, 1284, condomínio Residencial das Araucárias",
      complement:
        "Bloco Primavera, torre B, apartamento 1804. Entrada pela portaria de visitantes.",
      notes:
        "Alergia alimentar: conferir etiqueta. Entregar pela entrada lateral do condomínio, próximo à portaria de visitantes. Não deixar na recepção sem confirmação.",
      orderedAt: DEMO_EPOCH - 1284 * MINUTE,
    };
    state.orders[1] = {
      ...orders[1],
      customer: "王秀英",
      reference: "WHATSAPP-20261011-PEDIDO-ALMOCO-1284",
      notes: "<b>Sem talheres</b> — texto literal de teste.",
    };
    state.orders[2] = {
      ...orders[2],
      customer: "Jo",
      notes: "",
      complement: "",
    };
    state.orders[3] = { ...orders[3], customer: "نور الهدى عبد الرحمن" };
    state.couriers[0] = {
      ...state.couriers[0],
      name: "João Antônio de Oliveira e Albuquerque",
    };
  }
  if (scenario === "busy") {
    const many = Array.from({ length: 1000 }, (_, i) =>
      order(
        String(2000 + i),
        `Cliente demonstrativo ${i + 1}`,
        i % 2 ? "Centro" : "Vila Mariana",
        `Rua das Flores, ${i + 1}`,
        i % 9 === 0 ? "Conferir referência na entrega." : "",
        i % 90,
      ),
    );
    state.orders = [...many, ...orders.filter((o) => o.delivery !== "WAITING")];
    state.nextOrder = 3000;
  }
  if (scenario.startsWith("opt-")) {
    state.orders.filter(o => o.delivery === "WAITING").forEach((o, i) => {
      o.orderedAt = DEMO_EPOCH - 10 * MINUTE; o.promisedMinutes = 60;
      if (scenario === "opt-tight") o.promisedMinutes = 22 + i;
      if (scenario === "opt-impossible") o.promisedMinutes = 11;
      if (scenario === "opt-urgent" && i === 1) o.promisedMinutes = 27;
    });
    if (scenario === "opt-missing") state.orders[0].location = undefined;
    if (scenario === "opt-short") {
      state.orders = state.orders.filter((o,i) => i < 2 || o.delivery !== "WAITING");
      state.orders[1].location = fixtureCoordinate(3);
    }
  }
  return anchored(state);
}
