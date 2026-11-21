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
    await db.exec(readFileSync("tests/sql/delivery-core/execution-contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/tracking-contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/privacy-contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/notification-contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/board-contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/home-contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/earnings-contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/distance-contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/outcome-contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/order-edit-contracts.sql", "utf8"));
    await db.exec(readFileSync("tests/sql/delivery-core/push-contracts.sql", "utf8"));
    console.log("PASS: delivery core orders, shifts, route composition, route execution, public tracking, courier area and web push, courier privacy, notification outbox and store board commands, courier home, courier earnings, store data and distance checks, per-route outcomes, roles, idempotency and privileges");
  } finally { await db.close(); }
}
