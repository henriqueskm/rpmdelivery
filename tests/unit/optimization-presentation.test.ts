import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../../features/operations/fixtures.ts";
import { DEMO_EPOCH } from "../../features/operations/deadlines.ts";
import { demoOptimizationInput } from "../../features/operations/optimization-input.ts";
import { optimizeSequence } from "../../features/route-optimization/optimize.ts";
import { impactMetrics, recommendation, riskSummary, stopRisk, difference } from "../../features/operations/optimization-presentation.ts";
const compare = (scenario:"opt-urgent"|"opt-impossible"|"opt-short") => {
  const state=createDemoState(scenario),ids=state.orders.filter(o=>o.delivery==="WAITING").slice(0,3).map(o=>o.id);
  return optimizeSequence(demoOptimizationInput(state,ids,undefined,scenario,DEMO_EPOCH+300000,120));
};
test("apresentação urgente deriva ganhos/desvantagens reais sem mutar resultado nem tranquilizar margem crítica",()=>{
  const result=compare("opt-urgent"),before=structuredClone(result),metrics=impactMetrics(result);
  assert.deepEqual(metrics.map(m=>[m.before,m.after,m.tone]),[["1","0","gain"],["27","27","stable"],["8,4","8,5","attention"]]);
  assert.equal(metrics[2].delta,"+100 m");assert.equal(metrics[0].delta,"1 atraso evitado");
  assert.match(recommendation(result).reason,/Evita 1 atraso previsto/);
  assert.match(riskSummary(result)!.text,/inferior a 1 min/);
  assert.equal(stopRisk(result.suggested.stops[0],DEMO_EPOCH).tone,"attention");
  assert.deepEqual(result,before);
});
test("atrasos impossíveis continuam explícitos, mesmo com mesma quantidade e menor atraso total",()=>{
  const result=compare("opt-impossible");
  assert.match(riskSummary(result)!.title,/3 entregas permanecem com atraso/);
  assert.equal(riskSummary(result)!.tone,"danger");
  assert.match(recommendation(result).reason,/reduz o atraso total/);
  assert.equal(stopRisk(result.suggested.stops[0],DEMO_EPOCH+120000).tone,"danger");
  assert.match(stopRisk(result.suggested.stops[0],DEMO_EPOCH+120000).text,/Prazo vencido/);
});
test("margens abaixo de um/cinco minutos distinguem atenção de atraso e neutralidade",()=>{
  const base=compare("opt-urgent").suggested.stops[0];
  for(const [seconds,tone] of [[0,"attention"],[59,"attention"],[60,"attention"],[299,"attention"],[300,"stable"]] as const)
    assert.equal(stopRisk({...base,deadlineAt:base.completedAt+seconds*1000,lateSeconds:0},DEMO_EPOCH).tone,tone);
  assert.equal(stopRisk({...base,deadlineAt:base.completedAt-1000,lateSeconds:1},DEMO_EPOCH).tone,"danger");
});
test("deltas com arredondamento visual igual não são classificados como sem alteração",()=>{
  const result=compare("opt-urgent");
  result.suggested.durationSeconds=result.manual!.durationSeconds-10;
  const metric=impactMetrics(result)[1];
  assert.equal(metric.before,metric.after);assert.equal(metric.tone,"gain");assert.equal(metric.delta,"−10 s");
  assert.equal(difference(100,"meters"),"+100 m");assert.equal(difference(0,"seconds"),"Sem alteração");
});
test("piora relevante fica vermelha; reduções ficam verdes; manual sem percurso não inventa comparação",()=>{
  const result=compare("opt-urgent");
  result.suggested.durationSeconds=result.manual!.durationSeconds+300;
  result.suggested.distanceMeters=result.manual!.distanceMeters+1000;
  assert.deepEqual(impactMetrics(result).map(m=>m.tone),["gain","danger","danger"]);
  result.suggested.distanceMeters=result.manual!.distanceMeters-100;
  assert.equal(impactMetrics(result)[2].tone,"gain");
  result.manual=null;
  assert.ok(impactMetrics(result).every(m=>m.before==="—"&&m.tone==="stable"));
  assert.match(recommendation(result).reason,/não tem percurso completo/);
});
test("ordem já ótima recomenda manter e não exibe ganho inventado",()=>{
  const result=compare("opt-short");
  assert.equal(recommendation(result).title,"Mantenha a ordem atual");
  assert.ok(impactMetrics(result).every(m=>m.tone==="stable"));assert.equal(riskSummary(result),null);
});
