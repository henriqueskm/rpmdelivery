"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field";
import { AuthShell } from "@/components/auth-shell";
import { authMessage } from "@/lib/auth/errors";
import { getSupabase } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const router = useRouter();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email")).trim();
    const password = String(fields.get("password"));
    setError("");
    if (signup && password !== fields.get("confirmation")) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      const client = getSupabase();
      const result = signup
        ? await client.auth.signUp({
            email,
            password,
            options: {
              data: { name: String(fields.get("name")).trim() },
              emailRedirectTo: `${window.location.origin}/onboarding`,
            },
          })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) {
        setError(authMessage(result.error));
        return;
      }
      if (signup && !result.data.session) {
        setConfirmation(true);
        return;
      }
      router.replace("/onboarding");
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.includes("configurado")
          ? cause.message
          : "Não foi possível acessar sua conta. Confira a conexão e tente novamente.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <AuthShell expandedBrand>
      <span className="eyebrow">SUA PRÓXIMA ETAPA COMEÇA AQUI</span>
      <h1>
        {confirmation
          ? "Confira seu e-mail"
          : signup
            ? "Entre no ritmo."
            : "Bom ter você aqui."}
      </h1>
      <p className="form-description">
        {confirmation
          ? "Se o endereço puder ser cadastrado, você receberá um link de confirmação. Abra o e-mail para continuar."
          : signup
            ? "Crie sua conta. Depois, vamos preparar seu restaurante."
            : "Entre na sua conta e siga com a operação."}
      </p>
      {confirmation ? (
        <div className="success-panel" role="status">
          <span className="success-icon" aria-hidden="true">
            ✓
          </span>
          <p>Confirme seu endereço antes de entrar.</p>
          <Link className="button primary" href="/login">
            Voltar para o login <span aria-hidden="true">↗</span>
          </Link>
        </div>
      ) : (
        <form
          onSubmit={submit}
          aria-label={signup ? "Criar conta" : "Entrar na conta"}
          aria-busy={pending}
        >
          <fieldset disabled={pending}>
            {signup ? (
              <FormField
                label="Seu nome"
                id="name"
                name="name"
                autoComplete="name"
                placeholder="Como podemos chamar você?"
                maxLength={120}
                required
              />
            ) : null}
            <FormField
              label="E-mail"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="voce@restaurante.com"
              maxLength={254}
              required
            />
            <FormField
              label="Senha"
              id="password"
              name="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              placeholder={signup ? "Crie uma senha segura" : "Sua senha"}
              minLength={signup ? 8 : undefined}
              required
              hint={signup ? "Use pelo menos 8 caracteres." : undefined}
            />
            {signup ? (
              <FormField
                label="Confirmar senha"
                id="confirmation"
                name="confirmation"
                type="password"
                autoComplete="new-password"
                placeholder="Repita sua senha"
                required
              />
            ) : null}
            {error ? (
              <p className="notice error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="button primary" type="submit">
              {pending ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  {signup ? "Criando sua conta…" : "Entrando…"}
                </>
              ) : (
                <>
                  {signup ? "Criar minha conta" : "Entrar na minha conta"}{" "}
                  <span aria-hidden="true">↗</span>
                </>
              )}
            </button>
          </fieldset>
          <p className="form-switch">
            {signup ? "Já tem uma conta?" : "Primeira vez por aqui?"}{" "}
            <Link href={signup ? "/login" : "/cadastro"}>
              {signup ? "Entrar" : "Criar conta"}
            </Link>
          </p>
        </form>
      )}
      <div className="secure-note">
        <span aria-hidden="true">◇</span> Seu acesso, com segurança.
      </div>
    </AuthShell>
  );
}
