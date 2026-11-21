// Generates the key pair for browser notifications (VAPID, P-256) and saves it in the Supabase
// project linked to this folder. Run it yourself, from the project folder:
//   node scripts/generate-web-push-keys.mjs
// The private key is never printed or written to a file: it goes straight to the Supabase secrets.
// Only the public key is shown, for the site (Vercel). Running it again replaces both keys; whoever
// had turned the notifications on must turn them on again.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const base64url = bytes => Buffer.from(bytes).toString("base64url");
const publicKey = base64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;
if (Buffer.from(publicKey, "base64url").length !== 65 || Buffer.from(privateKey, "base64url").length !== 32) {
  throw new Error("Chaves geradas com tamanho inesperado.");
}

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log("Salvando as duas chaves no Supabase (a privada não aparece na tela)…");
// Quoted: on Windows the command goes through the shell.
const result = spawnSync("npx", ["supabase", "secrets", "set", "--workdir", `"${project}"`,
  `WEB_PUSH_PUBLIC_KEY=${publicKey}`, `WEB_PUSH_PRIVATE_KEY=${privateKey}`],
  { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
if (result.status !== 0) {
  console.error("\nNão consegui salvar no Supabase. Confira se esta pasta está ligada ao projeto (npx supabase link) e tente de novo.");
  process.exit(1);
}

console.log(`
Pronto: WEB_PUSH_PUBLIC_KEY e WEB_PUSH_PRIVATE_KEY estão no Supabase.

Agora, na Vercel → Settings → Environment Variables (Production), troque o valor de
NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY por esta chave pública (precisa ser a mesma do Supabase):

  ${publicKey}

Depois, faça um novo deploy na Vercel para o site ler a chave nova.
`);
