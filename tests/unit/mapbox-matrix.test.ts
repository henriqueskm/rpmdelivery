import {test} from "node:test";
import assert from "node:assert/strict";
import {createMapboxMatrixAdapter,MatrixError} from "../../services/routing/mapbox-matrix.ts";
import {fixtureCoordinate} from "../../features/route-optimization/fixtures.ts";
import type {Point} from "../../features/route-optimization/types.ts";
const points:Point[]=[0,1,2].map(i=>({id:`p${i}`,coordinate:{...fixtureCoordinate(i),source:"mapbox"}}));
const body=()=>({code:"Ok",durations:[[0,120,600],[240,0,480],[420,180,0]],
  distances:[[0,800,4500],[1500,0,3600],[3000,1200,0]],
  sources:points.map(p=>({location:[p.coordinate.longitude,p.coordinate.latitude]})),
  destinations:points.map(p=>({location:[p.coordinate.longitude,p.coordinate.latitude]}))});
const failure=(code:string)=>(e:unknown)=>e instanceof MatrixError&&e.code===code&&
  !e.message.includes("secret-fixture")&&!e.message.includes("api.mapbox");
test("Matrix server-only usa token previsto, perfil driving, duração/distância e cache defensivo",async()=>{
  let calls=0,time=0;
  const adapter=createMapboxMatrixAdapter({token:()=>"secret-fixture",now:()=>time,fetchImpl:async(url,init)=>{
    calls++;const u=new URL(String(url));
    assert.equal(u.origin,"https://api.mapbox.com");
    assert.equal(u.pathname.split("/").slice(0,5).join("/"),"/directions-matrix/v1/mapbox/driving");
    assert.equal(u.searchParams.get("annotations"),"duration,distance");
    assert.equal(u.searchParams.get("access_token"),"secret-fixture");
    assert.equal(u.searchParams.has("fallback_speed"),false);
    assert.equal(init?.cache,"no-store");
    return Response.json(body());
  }});
  const result=await adapter.getMatrix(points);
  assert.equal(result.source,"mapbox");assert.deepEqual(result.pointIds,["p0","p1","p2"]);
  result.durations[0][1]=999;
  assert.equal((await adapter.getMatrix(points)).durations[0][1],120);assert.equal(calls,1);
  time=31000;await adapter.getMatrix(points);assert.equal(calls,2);
});
test("input inválido, limites, duplicatas e coordenadas fictícias nunca chamam o provedor",async()=>{
  let calls=0;
  const adapter=createMapboxMatrixAdapter({token:()=>"secret-fixture",fetchImpl:async()=>{calls++;return Response.json(body());}});
  for(const data of [[],[points[0]],Array.from({length:10},(_,i)=>({...points[0],id:String(i)})),
    [points[0],points[0]],[{...points[0],coordinate:fixtureCoordinate(0)},points[1]],
    [{...points[0],coordinate:{...points[0].coordinate,longitude:181}},points[1]]]){
    await assert.rejects(adapter.getMatrix(data),failure("input"));
  }
  assert.equal(calls,0);
});
test("concorrência e cooldown impedem chamadas repetidas; cache não gera nova cobrança",async()=>{
  let calls=0,time=0,finish:(value:Response)=>void=()=>{};
  const adapter=createMapboxMatrixAdapter({token:()=>"secret-fixture",now:()=>time,fetchImpl:()=>{calls++;return new Promise(resolve=>finish=resolve);}});
  const first=adapter.getMatrix(points);
  await assert.rejects(adapter.getMatrix([...points].reverse()),failure("busy"));
  finish(Response.json(body()));await first;
  await adapter.getMatrix(points);assert.equal(calls,1);
  await assert.rejects(adapter.getMatrix([...points].reverse()),failure("busy"));
  time=1000;const second=adapter.getMatrix([...points].reverse());finish(Response.json(body()));await second;
  assert.equal(calls,2);
});
test("rate limit é respeitado sem retries ou vazamento de resposta",async()=>{
  let calls=0,time=0;
  const adapter=createMapboxMatrixAdapter({token:()=>"secret-fixture",now:()=>time,fetchImpl:async()=>{
    calls++;return calls===1?new Response("secret-fixture",{status:429,headers:{"Retry-After":"2"}}):Response.json(body());
  }});
  await assert.rejects(adapter.getMatrix(points),failure("rate-limit"));
  time=1500;await assert.rejects(adapter.getMatrix(points),failure("rate-limit"));assert.equal(calls,1);
  time=2000;await adapter.getMatrix(points);assert.equal(calls,2);
});
test("NoRoute, pares nulos, resposta malformada e falha de conexão ficam explícitos e seguros",async()=>{
  for(const [payload,code] of [
    [{code:"NoRoute"},"no-route"],[{...body(),durations:[]},"malformed"],
    [{...body(),destinations:[]},"malformed"],[{...body(),durations:[[0,-1,0],[0,0,0],[0,0,0]]},"malformed"],
    [{...body(),distances:[[0,null,1],[1,0,1],[1,1,0]]},"malformed"],
  ] as const){
    const adapter=createMapboxMatrixAdapter({token:()=>"secret-fixture",fetchImpl:async()=>Response.json(payload)});
    await assert.rejects(adapter.getMatrix(points),failure(code));
  }
  const data=body();data.durations[0][1]=null as never;data.distances[0][1]=null as never;
  const adapter=createMapboxMatrixAdapter({token:()=>"secret-fixture",fetchImpl:async()=>Response.json(data)});
  assert.equal((await adapter.getMatrix(points)).durations[0][1],null);
  const broken=createMapboxMatrixAdapter({token:()=>"secret-fixture",fetchImpl:async()=>{throw new Error("secret-fixture https://api.mapbox");}});
  await assert.rejects(broken.getMatrix(points),failure("unavailable"));
  const huge=createMapboxMatrixAdapter({token:()=>"secret-fixture",fetchImpl:async()=>new Response(" ".repeat(262145))});
  await assert.rejects(huge.getMatrix(points),failure("malformed"));
});
test("cancelamento antes/durante e timeout não iniciam retries nem retornam sucesso tardio",async()=>{
  let calls=0;
  const adapter=createMapboxMatrixAdapter({token:()=>"secret-fixture",fetchImpl:(_url,init)=>{
    calls++;return new Promise((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(new Error("secret-fixture")),{once:true}));
  }});
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(adapter.getMatrix(points,cancelled.signal),failure("cancelled"));assert.equal(calls,0);
  const controller=new AbortController(),pending=adapter.getMatrix(points,controller.signal);
  controller.abort();await assert.rejects(pending,failure("cancelled"));assert.equal(calls,1);
  const timeout=createMapboxMatrixAdapter({token:()=>"secret-fixture",timeoutMs:10,fetchImpl:(_url,init)=>new Promise((_resolve,reject)=>{
    init?.signal?.addEventListener("abort",()=>reject(new Error("secret-fixture")),{once:true});
  })});
  const keepAlive=setTimeout(()=>{},1000);
  try{await assert.rejects(timeout.getMatrix(points),failure("timeout"));}finally{clearTimeout(keepAlive);}
});
