import { test } from "node:test";
import assert from "node:assert/strict";
import { securityMigrations } from "../sql/security-migrations.ts";

const prerequisite = "20261013201122_postgres_global_routine_execute_prerequisite.sql";
const after = "20261013201124_postgres_public_default_privileges_hardening.sql";
test("security migration order supports independent prerequisite and rejects old/duplicate PR17 versions", () => {
  assert.equal(securityMigrations([prerequisite]).hardening, undefined);
  assert.equal(securityMigrations([after, prerequisite]).hardening, after);
  assert.throws(() => securityMigrations([prerequisite,
    "20261013192536_postgres_public_default_privileges_hardening.sql"]), /AFTER/);
  assert.throws(() => securityMigrations([prerequisite, after, after]), /at most/);
  assert.throws(() => securityMigrations([after]), /one global/);
  assert.doesNotThrow(() => securityMigrations());
});
