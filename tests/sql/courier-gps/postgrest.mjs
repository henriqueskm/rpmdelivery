// Only synthetic JWTs and an isolated local PostgREST. Never send these to Supabase.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const base = new URL(process.env.GPS_TEST_HTTP_URL ?? "http://127.0.0.1:3319");
if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" ||
    process.env.RPMDELIVERY_DISPOSABLE_POSTGRES !== "1") throw new Error("Requires opted-in loopback HTTP fixture");
const secret = "rpmdelivery-gps-synthetic-jwt-secret-for-local-tests-only";
const relationship=process.env.GPS_TEST_RELATIONSHIP??"SUSPENDED";
if(!["ACTIVE","PENDING","REJECTED","SUSPENDED"].includes(relationship)) throw new Error("Unknown fixture relationship");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(n) {
  const data = `${encode({alg:"HS256",typ:"JWT"})}.${encode({role:"authenticated",sub:id(n),exp:Math.floor(Date.now()/1000)+120})}`;
  return `${data}.${createHmac("sha256",secret).update(data).digest("base64url")}`;
}
async function get(path, actor) {
  const res = await fetch(new URL(path,base), {
    headers: actor ? {Authorization:`Bearer ${jwt(actor)}`} : {},
    signal:AbortSignal.timeout(10000),
  });
  return {status:res.status,body:await res.json()};
}
for (let i=0;i<30;i++) {
  try {
    const ready = await fetch(base,{signal:AbortSignal.timeout(2000)});
    // A configured auth denial at / also means the local HTTP server is ready.
    if([200,401,403].includes(ready.status)) break;
  }
  catch { /* Container schema cache may still be loading. */ }
  if(i===29) throw new Error("Local PostgREST did not become ready");
  await new Promise(resolve=>setTimeout(resolve,500));
}
for(const actor of [1,2,3,4,5,6,7]) {
  const identity=await get(`/couriers?select=id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color,created_at,updated_at`,actor);
  assert.equal(identity.status,200);
  const visible=[1,3].includes(actor)||([2,4,5].includes(actor)&&relationship==="ACTIVE")||([2,5].includes(actor)&&relationship==="PENDING");
  assert.equal(identity.body.length,visible?1:0);
  assert.ok(identity.body.every(row=>!("last_latitude" in row)&&!("last_longitude" in row)&&!("location_updated_at" in row)));
  for(const columns of ["*","last_latitude","last_longitude","location_updated_at","id,last_latitude"]) {
    const denied=await get(`/couriers?select=${encodeURIComponent(columns)}`,actor);
    assert.equal(denied.status,403,`actor ${actor}: ${columns}`);
    assert.equal(denied.body.code,"42501");
  }
  const gps=await get(`/courier_locations?select=route_id,latitude,longitude`,actor);
  assert.equal(gps.status,200);
  assert.deepEqual(gps.body.map(row=>row.route_id).sort(),actor===1?[id(501)]:actor===3?[id(501),id(502)]:[2,4,5].includes(actor)?[id(502)]:[]);
  console.log(`PASS: HTTP ${relationship} actor ${actor}: identity, wildcard/explicit GPS rejection, route-scoped GPS`);
}
for(const select of ["*","id","last_latitude"]) {
  const denied=await get(`/couriers?select=${select}`);
  assert.equal(denied.status,401);
  assert.equal(denied.body.code,"42501");
}
for(const path of [
  "/couriers?select=id&last_latitude=eq.-10",
  "/couriers?select=id&order=location_updated_at",
  `/profiles?select=id,couriers(last_latitude)&id=eq.${id(3)}`,
]) {
  const denied=await get(path,1);
  assert.equal(denied.status,403);
  assert.equal(denied.body.code,"42501");
}
console.log("PASS: GPS filters, ordering and embedding cannot bypass column permissions");
console.log("PASS: PostgREST anonymous reads denied; no runtime/product change");
