import { readFileSync, readdirSync } from "node:fs";
import { securityMigrations } from "./security-migrations.ts";

const read = (path) => readFileSync(path, "utf8");
export async function checkGlobalRoutines(PGlite) {
  const { prerequisite } = securityMigrations();
  const db = new PGlite();
  try {
    await db.exec(read("tests/sql/privileges/bootstrap.sql"));
    for (const file of readdirSync("supabase/migrations").sort()) {
      if (!file.endsWith(".sql") || file >= prerequisite) continue;
      await db.exec(read(`supabase/migrations/${file}`)
        .replace("create extension if not exists pgcrypto with schema extensions;", ""));
    }
    await db.exec(read("tests/sql/global-routines/fixtures.sql"));
    for (let application = 0; application < 2; application++) {
      await db.exec(read(`supabase/migrations/${prerequisite}`));
      await db.exec(read("tests/sql/global-routines/assertions.sql"));
      await db.exec(read("tests/sql/privileges/rpc-rls.sql"));
    }
    await db.exec("alter default privileges for role postgres grant execute on routines to service_role;");
    await db.exec(read(`supabase/migrations/${prerequisite}`));
    await db.exec(read("tests/sql/global-routines/global-grant.sql"));
    await db.exec("alter default privileges for role postgres revoke execute on routines from service_role;");
    console.log("PASS: supplementary PGlite global routines, explicit grants, RPC/RLS and reapplication");
  } finally { await db.close(); }
}
