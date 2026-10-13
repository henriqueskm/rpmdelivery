import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (name) => readFileSync(`tests/sql/privileges/${name}.sql`, "utf8");
const migration = readFileSync(
  "supabase/migrations/20261013192536_postgres_public_default_privileges_hardening.sql", "utf8",
);

// A second disposable instance keeps the existing geocoding fixture intact.
// PostgreSQL 17 in CI remains mandatory; PGlite is supplementary evidence.
export async function checkDefaultPrivileges(PGlite) {
  const db = new PGlite();
  try {
    await db.exec(read("bootstrap"));
    const { readdirSync } = await import("node:fs");
    for (const file of readdirSync("supabase/migrations").sort()) {
      if (!file.endsWith(".sql") || file >= "20261013192536") continue;
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8")
        .replace("create extension if not exists pgcrypto with schema extensions;", ""));
    }
    const before = (await db.query("select value from privilege_test.default_acls")).rows;
    await assert.rejects(db.exec(migration), /RPM_DEFAULT_PRIVILEGES_GLOBAL_GRANT/);
    await db.exec("rollback;");
    assert.deepEqual((await db.query("select value from privilege_test.default_acls")).rows, before);
    await db.exec(read("fixtures"));
    for (let application = 0; application < 2; application++) {
      await db.exec(migration);
      await db.exec(read("assertions"));
      await db.exec(read("rpc-rls"));
    }
    console.log("PASS: supplementary PGlite default ACLs, global guard, RPC/RLS and reapplication");
  } finally {
    await db.close();
  }
}
