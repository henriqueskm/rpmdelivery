import { test } from "node:test";
import assert from "node:assert/strict";
import { planRoutes } from "../../features/route-planning/plan.ts";
import { planningBatch, routeInput } from "../../features/route-planning/input.ts";
import { reviewGroups, planScore } from "../../features/route-planning/evaluation.ts";
import { EXACT_CALL_LIMIT, PERMUTATION_LIMIT, PlanningError, type PlanningInput } from "../../features/route-planning/types.ts";
import { fixtureCoordinate, fixtureMatrix } from "../../features/route-optimization/fixtures.ts";
import { estimateSequence } from "../../features/route-optimization/optimize.ts";
import { validateMatrix } from "../../features/route-optimization/validation.ts";
import { automaticInput } from "../../features/operations/automatic-input.ts";
import { automaticSnapshot } from "../../features/operations/automatic-assignment.ts";
import { createDemoState } from "../../features/operations/fixtures.ts";
import { availableCouriers, operationsReducer, type Command } from "../../features/operations/model.ts";
import { DEMO_EPOCH, MINUTE } from "../../features/operations/deadlines.ts";

function input(n=6,couriers=3,capacity=4):PlanningInput {
  const restaurant={id:"store",coordinate:fixtureCoordinate(0)};
  const orders=Array.from({length:n},(_,i)=>({id:`o${i}`,delivery:"WAITING",coordinate:fixtureCoordinate(1+i%8),deadlineAt:DEMO_EPOCH+60*MINUTE}));
  const batch=planningBatch(orders);
  return {restaurant,orders,couriers:Array.from({length:couriers},(_,i)=>({id:`c${i}`,eligible:true,queueOrder:i})),
    departureAt:DEMO_EPOCH,serviceSeconds:120,capacity,maxRouteSeconds:3600,
    matrix:fixtureMatrix([restaurant,...batch.map(o=>({id:o.id,coordinate:o.coordinate!}))],"demo")};
}
test("um pedido/motoboy, pureza, determinismo e FIFO sem duplicação",()=>{
  const data=input(1,1), before=structuredClone(data), a=planRoutes(data);
  assert.equal(a.routes.length,1);assert.deepEqual(a.routes[0].ids,["o0"]);assert.equal(a.routes[0].courierId,"c0");
  assert.deepEqual(data,before);assert.deepEqual(a,planRoutes(data));
  const multi=input(10,3,4);multi.couriers.reverse();multi.couriers.push({id:"reserved",eligible:false,queueOrder:-1});
  const plan=planRoutes(multi), ids=plan.routes.flatMap(r=>r.ids);
  assert.deepEqual(plan.routes.map(r=>r.courierId),["c0","c1","c2"].slice(0,plan.routes.length));
  assert.equal(new Set(ids).size,ids.length);assert.equal(plan.assignedCount+plan.pending.length,10);
  assert.ok(plan.routes.every(r=>r.ids.length<=4));assert.ok(!ids.includes("assigned"));
});
test("falta de motoboys, capacidade e pedidos já atribuídos permanecem explícitos",()=>{
  const data=input(6,0);let plan=planRoutes(data);
  assert.equal(plan.routes.length,0);assert.equal(plan.pending.length,6);assert.ok(plan.pending.every(p=>p.reason==="couriers"));
  const shortage=input(6,1,1);shortage.orders[5].delivery="ASSIGNED";
  shortage.matrix=fixtureMatrix([shortage.restaurant,...planningBatch(shortage.orders).map(o=>({id:o.id,coordinate:o.coordinate!}))],"demo");
  plan=planRoutes(shortage);assert.equal(plan.assignedCount,1);assert.equal(plan.pending.length,4);assert.ok(plan.pending.every(p=>p.id!=="o5"));
});
test("compatibilidade considera matriz dirigida, agrupando próximos e separando destino distante",()=>{
  const data=input(4,2,2), n=5;
  data.matrix.durations=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:600));
  data.matrix.distances=data.matrix.durations.map(row=>row.map(s=>s===null?null:s*10));
  for(const [a,b] of [[1,2],[3,4]]) {data.matrix.durations[a][b]=30;data.matrix.durations[b][a]=90;data.matrix.distances[a][b]=300;data.matrix.distances[b][a]=900;}
  const plan=planRoutes(data);
  assert.deepEqual(plan.routes.map(r=>[...r.ids].sort()),[["o0","o1"],["o2","o3"]]);
  for(const route of plan.routes)assert.deepEqual(route.estimate,estimateSequence(routeInput(data,route.ids),route.ids));
});
test("urgente distante participa primeiro; prazos impossíveis e pendentes entram no risco geral",()=>{
  const data=input(4,1,1);data.orders[1].deadlineAt=DEMO_EPOCH+5*MINUTE;
  const plan=planRoutes(data);assert.deepEqual(plan.routes[0].ids,["o1"]);assert.equal(plan.lateCount,1);
  data.orders.forEach(o=>o.deadlineAt=DEMO_EPOCH-MINUTE);
  const impossible=planRoutes(data);assert.equal(impossible.pendingOverdue,3);assert.equal(impossible.lateCount,1);
  assert.ok(planScore(data,impossible.routes)[0]>=4);
  assert.equal(impossible.assignedCount+impossible.pending.length,4);
});
test("sem coordenadas/percurso e limite de duração não inventam trajetos",()=>{
  const data=input(3);data.orders[0].coordinate=undefined;
  data.matrix=fixtureMatrix([data.restaurant,...planningBatch(data.orders).filter(o=>o.coordinate).map(o=>({id:o.id,coordinate:o.coordinate!}))],"opt-no-route");
  // Disconnect a known node in both directed grids.
  for(const grid of [data.matrix.durations,data.matrix.distances])for(let i=0;i<grid.length;i++){if(i!==1){grid[1][i]=null;grid[i][1]=null;}}
  const plan=planRoutes(data);assert.equal(plan.pending.find(p=>p.id==="o0")?.reason,"coordinates");
  assert.equal(plan.pending.find(p=>p.id==="o1")?.reason,"no-route");
  const edited=reviewGroups(data,plan.routes.map(r=>({courierId:r.courierId,ids:[...r.ids].reverse()})),plan.pending);
  assert.equal(edited.pending.find(p=>p.id==="o1")?.reason,"no-route");
  assert.equal(edited.pending.find(p=>p.id==="o0")?.reason,"coordinates");
  const long=input(1);long.maxRouteSeconds=60;assert.equal(planRoutes(long).pending[0].reason,"long-route");
});
test("1.000 pedidos: lote explícito, limites determinísticos, nenhuma omissão ou duplicação",()=>{
  const data=input(1000,6,8), before=structuredClone(data), start=performance.now(), plan=planRoutes(data);
  console.info(`planner1000: ${(performance.now()-start).toFixed(1)}ms, ${plan.exactCalls} calls, ${plan.permutations} permutations`);
  assert.equal(plan.analyzedIds.length,24);assert.equal(plan.waitingCount,1000);assert.equal(plan.assignedCount+plan.pending.length,1000);
  assert.equal(plan.pending.filter(p=>p.reason==="batch").length,976);
  assert.ok(plan.exactCalls<=EXACT_CALL_LIMIT);assert.ok(plan.permutations<=PERMUTATION_LIMIT);
  assert.deepEqual(data,before);assert.deepEqual(plan,planRoutes(data));
  assert.throws(()=>validateMatrix(data.matrix)); // Existing single-route/Mapbox default stays <=9 points.
});
test("ciclo dirigido por duas paradas é viável mesmo sem trajetos individuais de retorno",()=>{
  const data=input(2,1,2);
  data.matrix.durations=[[0,120,null],[null,0,120],[120,null,0]];
  data.matrix.distances=[[0,800,null],[null,0,800],[800,null,0]];
  const plan=planRoutes(data);assert.equal(plan.assignedCount,2);assert.equal(plan.pending.length,0);
  assert.deepEqual(plan.routes[0].ids,["o0","o1"]);
});
test("melhoria local final revisita grupos e aproveita vagas quando o score geral permite",()=>{
  const data=input(4,2,2);
  data.orders.forEach(o=>{o.coordinate=fixtureCoordinate(1);o.deadlineAt=DEMO_EPOCH-MINUTE;});
  data.matrix=fixtureMatrix([data.restaurant,...data.orders.map(o=>({id:o.id,coordinate:o.coordinate!}))],"demo");
  const plan=planRoutes(data);
  assert.equal(plan.assignedCount,4);assert.equal(plan.pending.length,0);
  assert.deepEqual(plan.routes.map(r=>r.ids.length),[2,2]);
  assert.equal(plan.lateCount,4);
});
test("input malformado, duplicatas, parâmetros e grupos conflitantes são recusados",()=>{
  const data=input();for(const capacity of [0,9,2.5,NaN])assert.throws(()=>planRoutes({...data,capacity}),PlanningError);
  assert.throws(()=>planRoutes({...data,orders:[...data.orders,data.orders[0]]}),PlanningError);
  assert.throws(()=>planRoutes({...data,couriers:[...data.couriers,data.couriers[0]]}),PlanningError);
  const malformed=structuredClone(data);malformed.matrix.durations[0][1]=-1;assert.throws(()=>planRoutes(malformed),PlanningError);
  assert.throws(()=>reviewGroups(data,[{courierId:"c0",ids:["o0"]},{courierId:"c1",ids:["o0"]}]),PlanningError);
  assert.throws(()=>reviewGroups(data,[{courierId:"c0",ids:["o0"]},{courierId:"c0",ids:["o1"]}]),PlanningError);
});
function assignment() {
  const state=createDemoState("opt-short"), parameters={departureAt:DEMO_EPOCH+5*MINUTE,serviceSeconds:120,capacity:1,maxRouteSeconds:3600};
  const plan=planRoutes(automaticInput(state,"opt-short",parameters));
  const command:Extract<Command,{type:"batch-assign"}>={type:"batch-assign",proposal:{snapshot:automaticSnapshot(state),plan},
    parameters,now:DEMO_EPOCH,groups:plan.routes.map(r=>({courierId:r.courierId,ids:r.ids}))};
  return {state,command};
}
test("confirmação individual/lote reserva PREPARING, retirada bloqueada e início exclusivo",()=>{
  const {state,command}=assignment(), one=operationsReducer(state,{...command,groups:[command.groups[0]]});
  assert.equal(one.routes.length,state.routes.length+1);
  const next=operationsReducer(state,command);assert.equal(next.routes.length,state.routes.length+2);
  const route=next.routes.find(r=>r.id==="demo-route-43")!;
  assert.equal(route.status,"PREPARING");assert.equal(route.pickupReleasedAt,null);
  assert.ok(!availableCouriers(next).some(c=>c.id===route.courierId));
  const start:Command={type:"start",routeId:route.id,actorId:route.courierId};
  assert.equal(operationsReducer(next,start),next);
  const released=operationsReducer(next,{type:"release",routeId:route.id,expectedOrderIds:route.orderIds,now:DEMO_EPOCH});
  assert.equal(operationsReducer(released,{...start,actorId:"rafa"}),released);
  assert.equal(operationsReducer(released,start).routes.find(r=>r.id===route.id)!.status,"ON_ROUTE");
});
test("reducer valida lote inteiro; conflito em segunda rota faz rollback sem aplicação parcial",()=>{
  const {state,command}=assignment(), before=structuredClone(state);
  const conflict={...command,groups:[command.groups[0],{...command.groups[1],ids:command.groups[0].ids}]};
  assert.equal(operationsReducer(state,conflict),state);
  assert.equal(operationsReducer(state,{...command,groups:[command.groups[0],{...command.groups[1],courierId:command.groups[0].courierId}]}),state);
  assert.deepEqual(state,before);
});
test("snapshot/versão/prazos, elegibilidade, composição e parâmetros obsoletos invalidam tudo",()=>{
  const {state,command}=assignment();
  const changes=[
    {...state,nextRoute:99}, {...state,defaultPromiseMinutes:30},
    {...state,couriers:state.couriers.map(c=>c.id===command.groups[1].courierId?{...c,activeLink:false}:c)},
    operationsReducer(state,{type:"deadline",orderId:command.groups[0].ids[0],orderedAt:state.orders[0].orderedAt,minutes:20}),
    operationsReducer(state,{type:"assign",ids:command.groups[0].ids,courierId:command.groups[0].courierId}),
  ];
  for(const changed of changes){assert.notEqual(changed,state);assert.equal(operationsReducer(changed,command),changed);}
  assert.equal(operationsReducer(state,{...command,parameters:{...command.parameters,capacity:2}}),state);
  assert.equal(operationsReducer(state,{...command,now:command.parameters.departureAt+1}),state);
});
test("ajustes mantêm ordem explícita, removidos continuam pendentes e não alteram estado",()=>{
  const state=createDemoState("opt-urgent"), input=automaticInput(state,"opt-urgent",{departureAt:DEMO_EPOCH+5*MINUTE,serviceSeconds:120,capacity:4,maxRouteSeconds:3600});
  const original=planRoutes(input), route=original.routes[0], ids=[...route.ids].reverse().slice(1);
  const adjusted=reviewGroups(input,[{courierId:route.courierId,ids}]);
  assert.deepEqual(adjusted.routes[0].ids,ids);assert.equal(adjusted.assignedCount+adjusted.pending.length,6);
  assert.equal(state.orders.filter(o=>o.delivery==="WAITING").length,6);
});
