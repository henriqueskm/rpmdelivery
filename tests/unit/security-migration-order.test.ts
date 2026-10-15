import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { securityMigrations } from "../sql/security-migrations.ts";

const prerequisite = "20261015013357_postgres_global_routine_execute_prerequisite.sql";
const after = "20261015013358_postgres_public_default_privileges_hardening.sql";
test("security migration order supports independent prerequisite and rejects old/duplicate PR17 versions", () => {
  assert.equal(securityMigrations([prerequisite]).hardening, undefined);
  assert.equal(securityMigrations([after, prerequisite]).hardening, after);
  assert.throws(() => securityMigrations([prerequisite,
    "20261013192536_postgres_public_default_privileges_hardening.sql"]), /AFTER/);
  assert.throws(() => securityMigrations([prerequisite,
    "20261013201124_postgres_public_default_privileges_hardening.sql"]), /AFTER/);
  assert.throws(() => securityMigrations([prerequisite, after, after]), /at most/);
  assert.throws(() => securityMigrations([after]), /one global/);
  assert.doesNotThrow(() => securityMigrations());
});

test("applied prerequisite identity rejects stale versions and timestamp aliases", () => {
  assert.throws(() => securityMigrations([
    "20261013201122_postgres_global_routine_execute_prerequisite.sql",
  ]), /applied remote version/);
  assert.throws(() => securityMigrations([prerequisite, prerequisite]), /one global/);
  assert.throws(() => securityMigrations([
    prerequisite, "20261015013357_unrelated_name.sql",
  ]), /Duplicate migration timestamp/);
});

test("version matching does not schedule the already-applied prerequisite again", () => {
  // Read-only catalog evidence from RpmDelivery; this is not a CLI dry-run.
  const applied = new Set([
    "20260915054631", "20260915055738", "20260915061305",
    "20260915063729", "20260915065701", "20260915071023",
    "20261002231941", "20261015013357",
  ]);
  const files = readdirSync("supabase/migrations").filter(f => f.endsWith(".sql"));
  const { hardening } = securityMigrations(files);
  const pending = files.filter(f => !applied.has(f.slice(0, 14))).sort();
  const pendingSecurity = pending.filter(f => f === prerequisite || f === hardening);
  assert.deepEqual(pendingSecurity, hardening ? [hardening] : []);
  assert.ok(!pending.includes(prerequisite));
});
