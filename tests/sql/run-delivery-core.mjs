import { readFileSync, readdirSync } from "node:fs";

// Disposable in-memory PGlite: synthetic roles and identities only.
export async function checkDeliveryCore(PGlite) {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("tests/sql/privileges/bootstrap.sql", "utf8"));
    for (const file of readdirSync("supabase/migrations").sort()) {
      if (!file.endsWith(".sql")) continue;
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8")
        .replace("create extension if not exists pgcrypto with schema extensions;", ""));
    }
    await db.exec(readFileSync("tests/sql/delivery-core/fixtures.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/route-contracts.sql", "utf8"));
    console.log("PASS: delivery core orders, shifts and route composition commands, roles, idempotency and privileges");
  } finally { await db.close(); }
}
