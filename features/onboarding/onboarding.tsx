"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { FormField } from "@/components/form-field";
import { WorkspaceStatus } from "@/components/workspace-status";
import { useWorkspace } from "@/hooks/use-workspace";
import { createRestaurant } from "@/services/restaurant";
import { SignOut } from "@/features/auth/sign-out";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import type { ResolvedAddress } from "@/services/geocoding/types";
import { formatBrazilianMobilePhone, isValidBrazilianMobilePhone } from "@/lib/brazilian-mobile-phone";

export function Onboarding() {
  const router = useRouter();
  const { state, retry } = useWorkspace("onboarding");
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState<ResolvedAddress | null>(null);
  const [phone, setPhone] = useState("");
  const phoneValid = isValidBrazilianMobilePhone(phone);
  const canSubmit = !!name.trim() && !!address && phoneValid && !pending && !uncertain;
  if (state.status !== "ready")
    return (
      <WorkspaceStatus
        message={state.status === "error" ? state.message : undefined}
        retry={retry}
      />
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !canSubmit || !address) return;
    submitting.current = true;
    setPending(true);
    setError("");
    let created = false;
    try {
      await createRestaurant(name, address, phone);
      created = true;
      router.replace("/dashboard");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível confirmar a criação.",
      );
      setUncertain(true);
    } finally {
      if (!created) {
        submitting.current = false;
        setPending(false);
      }
    }
  }

  return (
    <AuthShell>
      <div className="onboarding-step">
        <span className="step-number">01</span>
        <span>SEU RESTAURANTE</span>
        <span className="step-line" />
      </div>
      <h1>
        Vamos dar nome
        <br />à sua operação.
      </h1>
      <p className="form-description">
        Sua conta está pronta. Agora, conte um pouco sobre o seu restaurante.
      </p>
      <form
        onSubmit={submit}
        aria-label="Configurar restaurante"
        aria-busy={pending}
      >
        <fieldset disabled={pending || uncertain}>
          <FormField
            label="Nome do restaurante"
            id="restaurantName"
            name="restaurantName"
            placeholder="Ex.: Cozinha da Vila"
            autoComplete="organization"
            maxLength={160}
            pattern={".*\\S.*"}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <AddressAutocomplete onChange={setAddress} />
          <FormField
            label="Telefone (opcional)"
            id="phone"
            name="phone"
            type="tel"
            placeholder="(11) 99999-9999"
            autoComplete="tel"
            inputMode="tel"
            maxLength={19}
            value={phone}
            onChange={(event) => setPhone(formatBrazilianMobilePhone(event.target.value))}
            aria-invalid={!phoneValid}
            hint={phoneValid ? "Celular com DDD. Ex.: (11) 91234-5678." : "Informe um celular com DDD e 9 dígitos, começando com 9."}
          />
          <button className="button primary" type="submit" disabled={!canSubmit}>
            {pending ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Preparando restaurante…
              </>
            ) : (
              <>
                Preparar meu restaurante <span aria-hidden="true">↗</span>
              </>
            )}
          </button>
        </fieldset>
        {error ? (
          <div className="notice error" role="alert">
            {error}
            <button type="button" className="text-button" onClick={retry}>
              Conferir meu vínculo
            </button>
          </div>
        ) : null}
        {uncertain ? (
          <p className="field-hint">
            Se o vínculo não aparecer após a conferência, confirme com o suporte
            antes de repetir a criação. O envio está bloqueado nesta sessão para
            evitar duplicação.
          </p>
        ) : null}
      </form>
      <div className="signed-in">
        <span>
          Conectado como <strong>{state.user.email}</strong>
        </span>
        <SignOut />
      </div>
    </AuthShell>
  );
}
