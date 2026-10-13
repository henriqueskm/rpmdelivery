import { readdirSync } from "node:fs";

export function securityMigrations(files = readdirSync("supabase/migrations")) {
  const global = files.filter(f => f.endsWith("_postgres_global_routine_execute_prerequisite.sql"));
  const scoped = files.filter(f => f.endsWith("_postgres_public_default_privileges_hardening.sql"));
  if (global.length !== 1 || scoped.length > 1)
    throw new Error("Expected one global prerequisite and at most one scoped hardening migration.");
  if (scoped[0] && scoped[0] <= global[0])
    throw new Error("PR17 must execute AFTER its global prerequisite, including a fresh install.");
  return { prerequisite: global[0], hardening: scoped[0] };
}

if (process.argv.includes("--check-order")) console.log(securityMigrations().prerequisite);
