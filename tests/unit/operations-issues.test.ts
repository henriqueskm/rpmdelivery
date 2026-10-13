import {test} from "node:test";
import assert from "node:assert/strict";
import {createDemoState} from "../../features/operations/fixtures.ts";
import {operationsReducer as reduce, availableCouriers, type DemoState, type Command} from "../../features/operations/model.ts";
import {DEMO_EPOCH as T,MINUTE} from "../../features/operations/deadlines.ts";
import {DEMO_STORE_ACTOR as STORE, type IssueDecision} from "../../features/operations/issue-types.ts";
import {nextDelivery} from "../../features/operations/route-progress.ts";

const routeId="demo-route-43",actorId="joao";
function active(count=3):DemoState {
  let state=createDemoState("issues-none");
  state=reduce(state,{type:"assign",ids:state.orders.slice(0,count).map(o=>o.id),courierId:actorId});
  state=reduce(state,{type:"release",routeId,expectedOrderIds:state.routes[0].orderIds,now:T});
  return reduce(state,{type:"start",routeId,actorId,now:T});
}
function action(state:DemoState,type:"delivery-complete"|"delivery-failure",now=T):Extract<Command,{type:"delivery-complete"|"delivery-failure"}> {
  const order=nextDelivery(state,state.routes.find(r=>r.id===routeId)!)!;
  const base={routeId,orderId:order.id,actorId,now,commandId:`${type}:${order.id}:${order.attemptNumber}`,expectedAttempt:order.attemptNumber??1};
  return type==="delivery-complete"?{type,...base}:{type,...base,reason:"CUSTOMER_NOT_FOUND",description:"Interfone sem resposta."};
}
function decide(state:DemoState,decision:IssueDecision,now=T+1) {
  const issue=state.issues.find(i=>i.routeId===routeId&&i.status==="PENDING")!;
  return reduce(state,{type:"issue-decide",issueId:issue.id,decision,actorId:STORE,now,commandId:`decision:${issue.id}:${decision}`});
}
test("falha registra ocorrência e evento únicos; avança sem alterar a sequência planejada",()=>{
  const original=active(),cmd=action(original,"delivery-failure"),state=reduce(original,cmd);
  assert.equal(state.issues.length,1);const issue=state.issues[0];
  assert.equal(issue.courierId,actorId);assert.equal(issue.reportedAt,T);assert.equal(issue.decisionDeadline,T+10*MINUTE);
  assert.equal(state.orders.find(o=>o.id===issue.orderId)?.delivery,"ATTEMPT_FAILED");
  assert.equal(nextDelivery(state,state.routes[0])?.id,state.routes[0].orderIds[1]);
  assert.deepEqual(state.routes[0].orderIds,original.routes[0].orderIds);assert.equal(state.routes[0].status,"ON_ROUTE");
  assert.equal(reduce(state,cmd),state);
  assert.equal(reduce(state,{...cmd,commandId:"same-delivery-new-command"}),state);
  assert.equal(state.events.filter(e=>e.type==="DELIVERY_ATTEMPT_FAILED").length,1);
  assert.equal(original.issues.length,0);
});
test("motoboy incorreto, ordem futura, tentativa obsoleta, relógio passado e motivo inválido são bloqueados",()=>{
  const state=active(),cmd=action(state,"delivery-failure");assert.equal(cmd.type,"delivery-failure");
  if(cmd.type!=="delivery-failure")throw Error("fixture");
  for(const patch of [{actorId:"rafa"},{orderId:state.routes[0].orderIds[1]},{expectedAttempt:2},{now:T-1},
    {reason:"INVALID"},{reason:"OTHER",description:" "},{description:"x".repeat(501)},{commandId:"invalid / id"}])
    assert.equal(reduce(state,{...cmd,...patch} as Command),state);
  const pending=createDemoState();
  assert.equal(reduce(pending,{...cmd,routeId:"route-42",actorId:"marcos",orderId:"demo-order-1042"}),pending);
});
test("ver ou dispensar aviso não resolve, não muda entregas nem permite ator externo",()=>{
  const state=reduce(active(),action(active(),"delivery-failure")),id=state.issues[0].id;
  const viewed=reduce(state,{type:"alert-view",issueIds:[id,id],actorId:STORE,now:T+1,commandId:"view"});
  const dismissed=reduce(viewed,{type:"alert-dismiss",issueIds:[id],actorId:STORE,now:T+2,commandId:"dismiss"});
  assert.equal(dismissed.issues[0].status,"PENDING");assert.deepEqual(dismissed.orders,state.orders);
  assert.equal(dismissed.alertReceipts[id].viewedAt,T+1);assert.equal(dismissed.alertReceipts[id].dismissedAt,T+2);
  assert.equal(reduce(dismissed,{type:"alert-dismiss",issueIds:[id],actorId:STORE,now:T+3,commandId:"dismiss-again"}),dismissed);
  assert.equal(reduce(state,{type:"alert-dismiss",issueIds:[id],actorId:"rafa",now:T+1,commandId:"bad-actor"}),state);
});
test("nova tentativa entra depois das primeiras tentativas restantes e preserva sequência e prazos",()=>{
  const original=active();let state=decide(reduce(original,action(original,"delivery-failure")),"RETRY");
  assert.equal(state.issues[0].resolution,"RETRY");assert.equal(state.issues[0].decidedBy,STORE);
  assert.equal(nextDelivery(state,state.routes[0])?.id,state.routes[0].orderIds[1]);
  for(let i=0;i<2;i++)state=reduce(state,action(state,"delivery-complete",T+2+i));
  assert.equal(nextDelivery(state,state.routes[0])?.id,state.routes[0].orderIds[0]);
  assert.equal(nextDelivery(state,state.routes[0])?.attemptNumber,2);
  assert.deepEqual(state.routes[0].orderIds,original.routes[0].orderIds);
  for(const o of original.orders)assert.equal(state.orders.find(n=>n.id===o.id)?.orderedAt,o.orderedAt);
  state=reduce(state,action(state,"delivery-complete",T+4));assert.equal(state.routes[0].status,"RETURNING");
});
test("segunda falha de nova tentativa tem ID novo sem repetir a ocorrência anterior",()=>{
  let state=active(2);state=decide(reduce(state,action(state,"delivery-failure")),"RETRY");
  state=reduce(state,action(state,"delivery-complete",T+2));
  state=reduce(state,action(state,"delivery-failure",T+3));
  assert.equal(new Set(state.issues.map(i=>i.id)).size,2);assert.equal(state.issues[1].attempt,2);
  assert.equal(state.issues[1].resolution,"OTHERS_FINISHED");assert.equal(state.routes[0].status,"RETURNING");
});
for(const [decision,delivery] of [["RETURN","RETURN_TO_STORE"],["CANCEL","CANCELLED"]] as const)
  test(`${decision} encerra pendência e nunca permite nova tentativa do pedido terminal`,()=>{
    const failed=reduce(active(),action(active(),"delivery-failure"));const state=decide(failed,decision);
    const issue=state.issues[0];assert.equal(issue.status,"CLOSED");assert.equal(issue.resolution,decision);
    assert.equal(state.orders.find(o=>o.id===issue.orderId)?.delivery,delivery);
    assert.equal(reduce(state,{type:"issue-decide",issueId:issue.id,decision:"RETRY",actorId:STORE,now:T+2,commandId:"late-retry"}),state);
    assert.deepEqual(state.routes[0].orderIds,failed.routes[0].orderIds);
  });
test("cancelamento pela loja em ON_ROUTE pula parada, mas não permite motoboy cancelar ou reordenar",()=>{
  const original=active(),id=original.routes[0].orderIds[0];const cmd:Command={type:"delivery-cancel",routeId,orderId:id,actorId:STORE,now:T,commandId:"cancel"};
  assert.equal(reduce(original,{...cmd,actorId:"joao"}),original);
  const state=reduce(original,cmd);assert.equal(state.orders.find(o=>o.id===id)?.status,"CANCELLED");
  assert.equal(nextDelivery(state,state.routes[0])?.id,state.routes[0].orderIds[1]);
  assert.deepEqual(state.routes[0].orderIds,original.routes[0].orderIds);
  assert.equal(reduce(state,{type:"assign",ids:[...state.routes[0].orderIds].reverse(),courierId:actorId,editingId:routeId}),state);
});
test("prazo fixado na falha; mudar configuração vale só para falhas futuras",()=>{
  const failed=reduce(active(),action(active(),"delivery-failure"));
  const configured=reduce(failed,{type:"issue-timeout-config",minutes:1,actorId:STORE,now:T+1,commandId:"config"});
  assert.equal(configured.issues[0].decisionDeadline,T+10*MINUTE);
  const next=reduce(configured,action(configured,"delivery-failure",T+2));
  assert.equal(next.issues[1].decisionDeadline,T+2+MINUTE);
  for(const minutes of [0,-1,61,1.5,NaN])assert.equal(reduce(configured,{type:"issue-timeout-config",minutes,actorId:STORE,now:T+3,commandId:`invalid:${String(minutes)}`}),configured);
});
test("timeout vence corrida no instante limite independentemente da ordem dos comandos",()=>{
  const state=reduce(active(),action(active(),"delivery-failure")),issue=state.issues[0],now=issue.decisionDeadline;
  const decision:Command={type:"issue-decide",issueId:issue.id,decision:"RETRY",actorId:STORE,now,commandId:"at-deadline"};
  const tick:Command={type:"issues-tick",now};
  const first=reduce(reduce(state,decision),tick),second=reduce(reduce(state,tick),decision);
  assert.deepEqual(first,second);assert.equal(first.issues[0].resolution,"TIMEOUT");
  assert.equal(first.orders.find(o=>o.id===issue.orderId)?.delivery,"RETURN_TO_STORE");
  assert.equal(first.events.filter(e=>e.type==="ISSUE_AUTO_RETURNED").length,1);
  assert.equal(reduce(first,tick),first);
  const earlier=decide(state,"RETRY",now-1);assert.equal(earlier.issues[0].resolution,"RETRY");
  assert.equal(reduce(earlier,tick).issues[0].resolution,"RETRY");
});
test("concluir demais entregas converte falhas pendentes e libera retorno sem esperar timeout",()=>{
  const original=active(2);let state=reduce(original,action(original,"delivery-failure"));
  state=reduce(state,action(state,"delivery-complete",T+1));
  assert.equal(state.issues[0].resolution,"OTHERS_FINISHED");assert.equal(state.issues[0].closedAt,T+1);
  assert.equal(state.routes[0].status,"RETURNING");assert.equal(state.couriers.find(c=>c.id===actorId)?.shift,"RETURNING");
  assert.ok(!availableCouriers(state).some(c=>c.id===actorId));
  assert.equal(reduce(state,{type:"arrive",routeId,actorId:"rafa",now:T+2}),state);
  const arrived=reduce(state,{type:"arrive",routeId,actorId,now:T+2});assert.equal(arrived.routes[0].status,"COMPLETED");
  assert.equal(availableCouriers(arrived).at(-1)?.id,actorId);
  assert.equal(arrived.orders.find(o=>o.id===state.issues[0].orderId)?.delivery,"RETURN_TO_STORE");
  assert.equal(reduce(arrived,{type:"arrive",routeId,actorId,now:T+3}),arrived);
});
test("falha da única entrega não deixa motoboy preso nem ocorrência pendente impossível",()=>{
  const state=active(1),failed=reduce(state,action(state,"delivery-failure"));
  assert.equal(failed.routes[0].status,"RETURNING");assert.equal(failed.issues[0].resolution,"OTHERS_FINISHED");
});
test("cenários mantêm IDs/eventos coerentes; relógio sem mudanças não invalida planejamento, mesmo com 1.000 pedidos",()=>{
  const state=createDemoState("issues-busy");assert.equal(state.orders.filter(o=>o.delivery==="WAITING").length,1000);
  const start=performance.now();for(let i=0;i<100;i++)assert.equal(reduce(state,{type:"issues-tick",now:T+i*1000}),state);
  assert.ok(performance.now()-start<1500,"100 ticks locais devem permanecer limitados");
  for(const scenario of ["issues-address","issues-long","issues-expired"] as const){
    const fixture=createDemoState(scenario),issue=fixture.issues[0],event=fixture.events.find(e=>e.type==="DELIVERY_ATTEMPT_FAILED")!;
    assert.equal(event.at,issue.reportedAt);assert.equal(event.detail,issue.reason);
  }
});
