import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { checkDefaultPrivileges } from "./run-default-privileges.mjs";
import { checkGlobalRoutines } from "./run-global-routines.mjs";
import { checkGpsSequence } from "./run-gps-sequence.mjs";

// Explicitly in-memory PostgreSQL. No connection string, remote Auth or database.
const { PGlite } = await import(pathToFileURL(resolve(
  "playwright/.cache/sql/node_modules/@electric-sql/pglite/dist/index.js",
)));
const db = new PGlite();
try {
  await db.exec(`
    create schema auth; create schema extensions;
    create role anon; create role authenticated;
    create table auth.users (id uuid primary key, email text, phone text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  const files = readdirSync("supabase/migrations").sort();
  const migration = "20261002231941_restaurant_address_geocoding.sql";
  for (const name of files.filter((name) => name < migration && name.endsWith(".sql"))) {
    const sql = readFileSync(`supabase/migrations/${name}`, "utf8");
    // PGlite omits pgcrypto. gen_random_uuid is built into PostgreSQL.
    await db.exec(sql.replace("create extension if not exists pgcrypto with schema extensions;", ""));
  }
  await db.exec(`insert into public.restaurants (id,name,address,phone,latitude,longitude)
    values ('44444444-4444-4444-8444-444444444444','Legacy','Legacy address','1133334444',-23.55,null);`);
  const before = (await db.query("select name,address,phone,latitude,longitude from public.restaurants")).rows[0];
  await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  const after = (await db.query("select name,address,phone,latitude,longitude from public.restaurants")).rows[0];
  assert.deepEqual({ ...after, latitude: Number(after.latitude) }, { ...before, latitude: Number(before.latitude) });
  await db.exec(readFileSync("tests/sql/restaurant-geocoding.sql", "utf8"));
  console.log("PASS: migrations, legacy preservation, RPC fields, validation, grants and RLS");
  await checkGlobalRoutines(PGlite);
  await checkDefaultPrivileges(PGlite);
  await checkGpsSequence(PGlite);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
