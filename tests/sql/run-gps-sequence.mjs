import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

const migration = "20261015172010_courier_gps_sequence_privileges.sql";
export async function checkGpsSequence(PGlite) {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("tests/sql/privileges/bootstrap.sql", "utf8"));
    for (const file of readdirSync("supabase/migrations").sort()) {
      if (!file.endsWith(".sql") || file >= migration) continue;
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8")
        .replace("create extension if not exists pgcrypto with schema extensions;", ""));
    }
    await db.exec(readFileSync("tests/sql/courier-gps/fixtures.sql", "utf8"));
    await db.exec("create role sequence_inherited nologin;");
    await db.exec(readFileSync("tests/sql/gps-sequence/fixtures.sql", "utf8"));
    const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
    for (let attempt = 0; attempt < 2; attempt++) {
      await db.exec(sql);
      await db.exec(readFileSync("tests/sql/gps-sequence/assertions.sql", "utf8"));
    }
    await db.exec(`grant sequence_inherited to authenticated;
      grant usage on sequence public.courier_locations_id_seq to sequence_inherited;
      grant select on sequence public.courier_locations_id_seq to anon;`);
    const before = (await db.query("select relacl::text from pg_class where oid='public.courier_locations_id_seq'::regclass")).rows;
    await assert.rejects(db.exec(sql), /RPM_GPS_SEQUENCE_RESIDUAL_PRIVILEGE/);
    await db.exec("rollback;");
    assert.deepEqual((await db.query("select relacl::text from pg_class where oid='public.courier_locations_id_seq'::regclass")).rows, before);
    console.log("PASS: supplementary PGlite GPS sequence ACLs, counter preservation, rollback and reapplication");
  } finally {
    await db.close();
  }
}
