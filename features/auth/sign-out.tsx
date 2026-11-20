"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { forgetInvite } from "@/lib/invitations/context";

export function SignOut({ courier = false, className = "text-button", label = "Sair" }: {
  courier?: boolean; className?: string; label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setPending(true);
    setError("");
    try {
      const result = await getSupabase().auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
      forgetInvite();
      router.replace(courier ? "/login?perfil=motoboy" : "/login");
    } catch {
      setError("Não foi possível sair. Tente novamente.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={signOut}
      >
        {pending ? "Saindo…" : label}
      </button>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
