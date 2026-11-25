"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth-shell";
import { FormField } from "@/components/form-field";
import { linkKind } from "@/features/auth/reset-link";
import { authMessage } from "@/lib/auth/errors";
import { getSupabase } from "@/lib/supabase/client";

// The e-mail link lands here with the recovery tokens (or an error) in the hash. supabase-js reads and
// clears the hash while it starts, so the hash is read once, when this module loads on the page.
const landingHash = typeof window === "undefined" ? "" : window.location.hash;

type Step = "checking" | "ask" | "sent" | "choose" | "done" | "expired";

export function PasswordReset() {
  const [step, setStep] = useState<Step>("checking");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    // The server renders "checking" (it cannot see the hash); the browser decides right after.
    const kind = linkKind(landingHash);
    const next: Promise<Step> = kind === "recovery"
      ? getSupabase().auth.getSession().then(({ data }) => (data.session ? "choose" : "expired"))
      : Promise.resolve(kind === "none" ? "ask" : "expired");
    let active = true;
    next.catch((): Step => "expired").then((step) => { if (active) setStep(step); });
    return () => { active = false; };
  }, []);

  async function run(event: FormEvent<HTMLFormElement>, action: (fields: FormData) => Promise<void>) {
    event.preventDefault();
    if (submitting.current) return;
    const fields = new FormData(event.currentTarget);
    setError("");
    submitting.current = true;
    setPending(true);
    try {
      await action(fields);
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes("configurado")
        ? cause.message
        : "Não foi possível concluir agora. Confira a conexão e tente novamente.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const ask = (event: FormEvent<HTMLFormElement>) => run(event, async (fields) => {
    const email = String(fields.get("email")).trim();
    const { error: failure } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    if (failure) setError(authMessage(failure));
    else setStep("sent");
  });

  const choose = (event: FormEvent<HTMLFormElement>) => run(event, async (fields) => {
    const password = String(fields.get("password"));
    if (password !== fields.get("confirmation")) { setError("As senhas precisam ser iguais."); return; }
    const client = getSupabase();
    const { error: failure } = await client.auth.updateUser({ password });
    if (failure) {
      setError(failure.code === "same_password" ? "Escolha uma senha diferente da anterior." : authMessage(failure));
      return;
    }
    // The new password is set; this browser does not need to stay signed in (often the courier's phone).
    await client.auth.signOut({ scope: "local" });
    setStep("done");
  });

  const titles: Record<Step, [string, string]> = {
    checking: ["Abrindo o link…", "Só um instante."],
    ask: ["Esqueceu a senha?", "Digite o e-mail da sua conta. Vamos mandar um link para você criar uma senha nova."],
    sent: ["Confira seu e-mail", "Se existir uma conta com esse e-mail, o link chega em alguns minutos. Olhe também o spam."],
    choose: ["Crie sua senha nova", "Depois, entre no app ou no painel com ela."],
    done: ["Senha alterada", "Volte ao app RpmDelivery Motoboy ou ao painel da loja e entre com a senha nova."],
    expired: ["Esse link não vale mais", "Ele expirou ou já foi usado. Peça um link novo."],
  };
  const [title, description] = titles[step];

  return (
    <AuthShell>
      <span className="eyebrow">ACESSO À SUA CONTA</span>
      <h1>{title}</h1>
      <p className="form-description">{description}</p>

      {step === "ask" ? (
        <form onSubmit={ask} aria-label="Pedir link para nova senha" aria-busy={pending}>
          <fieldset disabled={pending}>
            <FormField label="E-mail" id="email" name="email" type="email" autoComplete="email"
              placeholder="voce@email.com" maxLength={254} required />
            {error ? <p className="notice error" role="alert">{error}</p> : null}
            <button className="button primary" type="submit">
              {pending ? <><span className="spinner" aria-hidden="true" />Enviando…</> : <>Enviar link <span aria-hidden="true">↗</span></>}
            </button>
          </fieldset>
          <p className="form-switch">Lembrou a senha? <Link prefetch={false} href="/login">Entrar</Link></p>
        </form>
      ) : null}

      {step === "choose" ? (
        <form onSubmit={choose} aria-label="Criar senha nova" aria-busy={pending}>
          <fieldset disabled={pending}>
            <FormField label="Senha nova" id="password" name="password" type="password" autoComplete="new-password"
              placeholder="Crie uma senha segura" minLength={8} required hint="Use pelo menos 8 caracteres." />
            <FormField label="Confirmar senha" id="confirmation" name="confirmation" type="password"
              autoComplete="new-password" placeholder="Repita a senha nova" required />
            {error ? <p className="notice error" role="alert">{error}</p> : null}
            <button className="button primary" type="submit">
              {pending ? <><span className="spinner" aria-hidden="true" />Salvando…</> : <>Salvar senha nova <span aria-hidden="true">↗</span></>}
            </button>
          </fieldset>
        </form>
      ) : null}

      {step === "sent" || step === "done" ? (
        <div className="success-panel" role="status">
          <span className="success-icon" aria-hidden="true">✓</span>
          <p>{step === "sent" ? "Abra o link no celular ou no computador." : "Pronto. Sua senha antiga não funciona mais."}</p>
          <Link prefetch={false} className="button primary" href="/login">
            Entrar no painel <span aria-hidden="true">↗</span>
          </Link>
        </div>
      ) : null}

      {step === "expired" ? (
        <button className="button primary" type="button" onClick={() => { setError(""); setStep("ask"); }}>
          Pedir link novo <span aria-hidden="true">↗</span>
        </button>
      ) : null}

      <div className="secure-note">
        <span aria-hidden="true">◇</span> Seu acesso, com segurança.
      </div>
    </AuthShell>
  );
}
