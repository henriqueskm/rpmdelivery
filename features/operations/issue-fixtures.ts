import { operationsReducer, type DemoState } from "./model.ts";
import { DEMO_EPOCH, MINUTE } from "./deadlines.ts";
import { DEMO_STORE_ACTOR } from "./issue-types.ts";

export const issueScenarios = [
  ["issues-none", "Ocorrências · nenhuma"], ["issues-new", "Ocorrências · uma nova"],
  ["issues-multiple", "Ocorrências · simultâneas"], ["issues-client", "Ocorrências · cliente não localizado"],
  ["issues-address", "Ocorrências · endereço"], ["issues-retry", "Ocorrências · nova tentativa"],
  ["issues-return", "Ocorrências · retornar pedido"], ["issues-cancel", "Ocorrências · cancelamento"],
  ["issues-expired", "Ocorrências · prazo expirado"], ["issues-last", "Ocorrências · concluir demais"],
  ["issues-busy", "Ocorrências · 1.000 pedidos"], ["issues-long", "Ocorrências · textos longos"],
] as const;

export function issueFixture(state: DemoState, scenario: string): DemoState {
  if (["issues-none", "issues-new", "issues-multiple", "issues-busy"].includes(scenario)) {
    state = {...state, issues: [], events: [], orders: state.orders.map(o => o.delivery === "ATTEMPT_FAILED" ? {...o, delivery: "ON_ROUTE"} : o)};
  }
  if (scenario === "issues-multiple") {
    state = operationsReducer(state, {type: "release", routeId: "route-42", expectedOrderIds: state.routes[0].orderIds, now: DEMO_EPOCH});
    state = operationsReducer(state, {type: "start", routeId: "route-42", actorId: "marcos", now: DEMO_EPOCH});
    state = operationsReducer(state, {type: "assign", ids: ["demo-order-1048", "demo-order-1047"], courierId: "livia"});
    state = operationsReducer(state, {type: "release", routeId: "demo-route-43", expectedOrderIds: state.routes[0].orderIds, now: DEMO_EPOCH});
    state = operationsReducer(state, {type: "start", routeId: "demo-route-43", actorId: "livia", now: DEMO_EPOCH});
  }
  if (scenario === "issues-address") state = {...state, issues: state.issues.map(i => ({...i, reason: "ADDRESS_PROBLEM", description: "Numeração não encontrada. Conferir entrada pela rua lateral."}))};
  if (scenario === "issues-expired") state = {...state, issues: state.issues.map(i => ({...i, reportedAt: DEMO_EPOCH-11*MINUTE, decisionDeadline: DEMO_EPOCH-MINUTE}))};
  if (["issues-retry", "issues-return", "issues-cancel"].includes(scenario)) state = operationsReducer(state, {
    type: "issue-decide", issueId: state.issues[0].id, decision: scenario === "issues-retry" ? "RETRY" : scenario === "issues-return" ? "RETURN" : "CANCEL",
    actorId: DEMO_STORE_ACTOR, now: DEMO_EPOCH, commandId: `fixture:${scenario}`,
  });
  if (scenario === "issues-long") {
    state = {...state, couriers: state.couriers.map(c => c.id === "rafa" ? {...c, name: "Rafael Antônio de Oliveira e Albuquerque"} : c),
      routes:state.routes.map(r=>r.id==="route-41"?{...r,orderIds:[...r.orderIds,"demo-order-1043"]}:r),
      orders: state.orders.map(o => ["demo-order-1040", "demo-order-1039", "demo-order-1043"].includes(o.id) ? {...o,
        ...(o.id==="demo-order-1043"?{delivery:"ON_ROUTE",status:"DELIVERING"}:{}),
        customer: "Maria Aparecida de Albuquerque e Vasconcelos", neighborhood: "Residencial Parque dos Girassóis — Setor Norte",
        address: "Avenida Doutor Antônio de Oliveira e Silva, 1284, condomínio Residencial das Araucárias",
        complement: "Bloco Primavera, apartamento 1804. Entrada pela portaria de visitantes.",
        notes: "Alergia alimentar: conferir etiqueta. Não deixar na recepção sem confirmação.",
      } : o),
      issues: state.issues.map(i => ({...i, reason: "OTHER", description: "Portaria de visitantes em manutenção. A entrada lateral está fechada; cliente pediu para conferir a alternativa com o restaurante antes de nova tentativa."})),
    };
  }
  return {...state,events:state.events.map(e=>{
    const issue=state.issues.find(i=>i.id===e.issueId);
    return e.type==="DELIVERY_ATTEMPT_FAILED"&&issue?{...e,at:issue.reportedAt,detail:issue.reason}:e;
  })};
}
