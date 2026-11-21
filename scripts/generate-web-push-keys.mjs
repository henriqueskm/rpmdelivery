// Generates the key pair for browser notifications (VAPID, P-256). Run it yourself:
//   node scripts/generate-web-push-keys.mjs
// It only prints to your terminal and writes no file. The private key is a secret: put it in the
// Supabase secrets, never in a file, a PR or a chat. The public key goes to the site (Vercel) and to Supabase.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const base64url = bytes => Buffer.from(bytes).toString("base64url");
const publicKey = base64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;

console.log(`
Chave pública (Vercel e Supabase):
  ${publicKey}

Chave privada (só no Supabase, secreta):
  ${privateKey}

1. Supabase (no terminal, na pasta do projeto):
   npx supabase secrets set --workdir . WEB_PUSH_PUBLIC_KEY=${publicKey} WEB_PUSH_PRIVATE_KEY=<a chave privada acima>

2. Vercel → Settings → Environment Variables (Production):
   NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY = ${publicKey}
   Depois, faça um novo deploy para o site ler a chave.

Guarde a chave privada num gerenciador de senhas. Se ela vazar, gere um novo par:
quem já tinha ligado os avisos precisa ligar de novo.
`);
