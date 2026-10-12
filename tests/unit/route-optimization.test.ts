import {test} from "node:test";
import assert from "node:assert/strict";
import {optimizeSequence,estimateSequence} from "../../features/route-optimization/optimize.ts";
import {OptimizationError,type OptimizationInput} from "../../features/route-optimization/types.ts";
import {fixtureCoordinate,fixtureMatrix} from "../../features/route-optimization/fixtures.ts";
import {createDemoState} from "../../features/operations/fixtures.ts";
import {demoOptimizationInput,proposalSignature} from "../../features/operations/optimization-input.ts";
import {operationsReducer} from "../../features/operations/model.ts";
import {DEMO_EPOCH,MINUTE} from "../../features/operations/deadlines.ts";

function input(n=3):OptimizationInput{
  const restaurant={id:"store",coordinate:fixtureCoordinate(0)};
  const orders=Array.from({length:n},(_,i)=>({id:`o${i}`,coordinate:fixtureCoordinate(i+1),deadlineAt:DEMO_EPOCH+60*MINUTE}));
  return {restaurant,orders,departureAt:DEMO_EPOCH,serviceSeconds:120,phase:"DRAFT",matrix:fixtureMatrix([restaurant,...orders],"demo")};
}
const fails=(fn:()=>unknown,code:string)=>assert.throws(fn,e=>e instanceof OptimizationError&&e.code===code);
test("determinismo, pureza, conjunto exato e comparação justa com atendimento e retorno",()=>{
  const data=input(),before=structuredClone(data);
  const a=optimizeSequence(data),b=optimizeSequence(data);
  assert.deepEqual(a,b);assert.deepEqual(data,before);
  assert.deepEqual([...a.suggested.ids].sort(),data.orders.map(o=>o.id).sort());
  assert.equal(a.examined,6);
  for(const route of [a.manual!,a.suggested]){
    assert.equal(route.durationSeconds,route.travelSeconds+3*120);
    assert.equal(route.returnAt,DEMO_EPOCH+route.durationSeconds*1000);
    assert.equal(route.stops[0].completedAt-route.stops[0].arrivalAt,120000);
  }
});
test("matriz assimétrica determina viagens em direções distintas e retorno participa da escolha",()=>{
  const data=input(2);
  data.matrix.durations=[[0,1,1],[1,0,8],[20,2,0]];
  data.matrix.distances=[[0,100,100],[100,0,800],[2000,200,0]];
  assert.equal(estimateSequence(data,["o0","o1"])!.travelSeconds,29);
  assert.equal(estimateSequence(data,["o1","o0"])!.travelSeconds,4);
  assert.deepEqual(optimizeSequence(data).suggested.ids,["o1","o0"]);
});
test("prioridade evita atrasos mesmo com viagem maior; atraso usa conclusão do atendimento",()=>{
  const data=input(2);
  data.matrix.durations=[[0,60,60],[60,0,600],[600,60,0]];
  data.matrix.distances=[[0,100,100],[100,0,1000],[1000,100,0]];
  data.orders[0].deadlineAt=DEMO_EPOCH+180000;
  data.orders[1].deadlineAt=DEMO_EPOCH+1000000;
  const comparison=optimizeSequence(data);
  assert.deepEqual(comparison.suggested.ids,["o0","o1"]);
  assert.equal(comparison.suggested.lateCount,0);
  data.orders[0].deadlineAt=DEMO_EPOCH+179000;
  assert.equal(estimateSequence(data,["o0","o1"])!.stops[0].lateSeconds,1);
});
test("prazos impossíveis são explícitos em busca exaustiva, nunca uma promessa de cumprimento",()=>{
  const data=input();
  data.orders.forEach(o=>o.deadlineAt=DEMO_EPOCH);
  const result=optimizeSequence(data);
  assert.equal(result.allDeadlinesPossible,false);assert.equal(result.suggested.lateCount,3);
});
test("destinos desconectados e retorno impossível não produzem distâncias ou removem pedidos",()=>{
  const data=input(2);
  data.matrix.durations=[[0,1,null],[1,0,null],[null,null,0]];
  data.matrix.distances=[[0,1,null],[1,0,null],[null,null,0]];
  fails(()=>optimizeSequence(data),"no-route");
  const another=input(2);
  another.matrix.durations[1][0]=null;another.matrix.distances[1][0]=null;
  another.matrix.durations[2][0]=null;another.matrix.distances[2][0]=null;
  fails(()=>optimizeSequence(another),"no-route");
});
test("alguma aresta nula pode permitir outra ordem completa; manual sem rota fica indisponível",()=>{
  const data=input(2);
  data.matrix.durations[1][2]=null;data.matrix.distances[1][2]=null;
  const result=optimizeSequence(data);
  assert.equal(result.manual,null);assert.deepEqual(result.suggested.ids,["o1","o0"]);
});
test("mesma origem/destino não colapsa IDs e preserva atendimento por entrega",()=>{
  const data=input(2);
  data.orders[0].coordinate=data.restaurant.coordinate;data.orders[1].coordinate=data.restaurant.coordinate;
  data.matrix=fixtureMatrix([data.restaurant,...data.orders],"demo");
  const result=optimizeSequence(data);
  assert.equal(result.suggested.travelSeconds,0);assert.equal(result.suggested.durationSeconds,240);
  assert.equal(result.suggested.stops[1].arrivalAt,DEMO_EPOCH+120000);
  assert.deepEqual(result.suggested.ids,["o0","o1"]);
});
test("limite de oito é completo e nove/zero são rejeitados sem truncamento",()=>{
  const data=input(8),result=optimizeSequence(data);
  assert.equal(result.examined,40320);assert.equal(result.suggested.ids.length,8);
  fails(()=>optimizeSequence({...data,orders:[...data.orders,{...data.orders[0],id:"extra"}]}),"limit");
  fails(()=>optimizeSequence({...data,orders:[]}),"limit");
});
test("IDs duplicados, coord inválida/não confirmada e matriz de outros pontos são rejeitados",()=>{
  const data=input();
  fails(()=>optimizeSequence({...data,orders:[data.orders[0],data.orders[0]]}),"invalid");
  fails(()=>optimizeSequence({...data,restaurant:{...data.restaurant,coordinate:{...data.restaurant.coordinate,latitude:91}}}),"coordinates");
  fails(()=>optimizeSequence({...data,restaurant:{...data.restaurant,coordinate:{...data.restaurant.coordinate,confirmed:false} as never}}),"coordinates");
  fails(()=>optimizeSequence({...data,matrix:{...data.matrix,pointIds:["wrong",...data.matrix.pointIds.slice(1)]}}),"matrix");
  fails(()=>estimateSequence(data,["o0","o0","o1"]),"invalid");
  fails(()=>estimateSequence(data,["o0","o1","missing"]),"invalid");
});
test("matrizes malformadas/NaN, tempos negativos e hipóteses inválidas são recusados",()=>{
  const data=input();
  for(const value of [NaN,-1,Infinity,604801]){
    const copy=structuredClone(data);copy.matrix.durations[0][1]=value;
    fails(()=>optimizeSequence(copy),"matrix");
  }
  const copy=structuredClone(data);copy.matrix.distances[0][1]=null;
  fails(()=>optimizeSequence(copy),"matrix");
  fails(()=>optimizeSequence({...data,matrix:{...data.matrix,durations:[]}}),"matrix");
  for(const value of [-1,1801,NaN,1.2])fails(()=>optimizeSequence({...data,serviceSeconds:value}),"invalid");
  for(const value of [0,NaN,Infinity])fails(()=>optimizeSequence({...data,departureAt:value}),"invalid");
  fails(()=>optimizeSequence({...data,phase:"ON_ROUTE"}),"phase");
});
test("proposta invalida com seleção, prazo, coordenadas, ordem ou fase modificados",()=>{
  const state=createDemoState(),ids=state.orders.slice(0,3).map(o=>o.id),key=proposalSignature(state,ids);
  assert.notEqual(proposalSignature(state,[...ids].reverse()),key);
  assert.notEqual(proposalSignature(state,ids.slice(1)),key);
  const deadline=operationsReducer(state,{type:"deadline",orderId:ids[0],orderedAt:state.orders[0].orderedAt,minutes:80});
  assert.notEqual(proposalSignature(deadline,ids),key);
  const coords={...state,orders:state.orders.map(o=>o.id===ids[0]?{...o,location:fixtureCoordinate(8)}:o)};
  assert.notEqual(proposalSignature(coords,ids),key);
});
test("aplicar ordem sugerida ao mesmo conjunto preserva liberação; ON_ROUTE rejeita no domínio",()=>{
  const state=createDemoState(),route=state.routes[0];
  const released=operationsReducer(state,{type:"release",routeId:route.id,expectedOrderIds:route.orderIds,now:DEMO_EPOCH});
  const result=optimizeSequence(demoOptimizationInput(released,route.orderIds,route.id,"demo",DEMO_EPOCH,120));
  const saved=operationsReducer(released,{type:"assign",editingId:route.id,ids:result.suggested.ids,courierId:route.courierId});
  assert.equal(saved.routes[0].pickupReleasedAt,DEMO_EPOCH);
  const started=operationsReducer(saved,{type:"start",routeId:route.id,actorId:route.courierId});
  assert.notEqual(proposalSignature(started,route.orderIds,route.id),proposalSignature(saved,route.orderIds,route.id));
  fails(()=>demoOptimizationInput(started,route.orderIds,route.id,"demo",DEMO_EPOCH,120),"phase");
  assert.equal(operationsReducer(started,{type:"assign",editingId:route.id,ids:[...route.orderIds].reverse(),courierId:route.courierId}),started);
});
