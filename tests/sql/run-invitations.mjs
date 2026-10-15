import { readFileSync, readdirSync } from "node:fs";
export async function checkInvitations(PGlite) {
  const db = new PGlite();
  const migration = "20261015221053_courier_invitations_commands.sql";
  try {
    await db.exec(readFileSync("tests/sql/privileges/bootstrap.sql", "utf8"));
    for (const file of readdirSync("supabase/migrations").sort()) {
      if (!file.endsWith(".sql") || file >= migration) continue;
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8")
        .replace("create extension if not exists pgcrypto with schema extensions;", ""));
    }
    // PGlite has no pgcrypto. This test-only substitute is NOT evidence of
    // cryptographic randomness; native PG17 executes the real pgcrypto routine.
    await db.exec(`create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$
      select substring(decode(replace(gen_random_uuid()::text,'-',''),'hex') from 1 for n)
    $$;`);
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    await db.exec(readFileSync("tests/sql/courier-gps/fixtures.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/invitations/fixtures.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/invitations/contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/invitations/registration.sql", "utf8"));
    console.log("PASS: supplementary PGlite invitation RPCs, roles, lifecycle, attempts and hardening");
  } finally { await db.close(); }
}
