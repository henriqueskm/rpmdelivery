import { readdirSync } from "node:fs";

export function securityMigrations(files = readdirSync("supabase/migrations")) {
  const global = files.filter(f => f.endsWith("_postgres_global_routine_execute_prerequisite.sql"));
  const scoped = files.filter(f => f.endsWith("_postgres_public_default_privileges_hardening.sql"));
  if (global.length !== 1 || scoped.length > 1)
    throw new Error("Expected one global prerequisite and at most one scoped hardening migration.");
  if (global[0] !== "20261015013357_postgres_global_routine_execute_prerequisite.sql")
    throw new Error("Global prerequisite must match applied remote version 20261015013357.");
  const versions = files.filter(f => f.endsWith(".sql")).map(f => {
    if (!/^\d{14}_.+\.sql$/.test(f)) throw new Error("Invalid migration filename.");
    return f.slice(0, 14);
  });
  if (new Set(versions).size !== versions.length)
    throw new Error("Duplicate migration timestamp.");
  if (scoped[0] && scoped[0] <= global[0])
    throw new Error("PR17 must execute AFTER its global prerequisite, including a fresh install.");
  return { prerequisite: global[0], hardening: scoped[0] };
}

if (process.argv.includes("--check-order")) console.log(securityMigrations().prerequisite);
