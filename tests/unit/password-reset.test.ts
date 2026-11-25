import { test } from "node:test";
import assert from "node:assert/strict";
import { linkKind } from "../../features/auth/reset-link.ts";

test("o link do e-mail de recuperação abre a troca de senha", () => {
  assert.equal(linkKind("#access_token=x&refresh_token=y&type=recovery&expires_in=3600"), "recovery");
});

test("link expirado ou já usado vira erro", () => {
  assert.equal(linkKind("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid"), "error");
});

test("sem link, a página pede o e-mail", () => {
  assert.equal(linkKind(""), "none");
  assert.equal(linkKind("#type=signup&access_token=x"), "none");
});
