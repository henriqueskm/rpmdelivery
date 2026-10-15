"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { forgetInvite } from "@/lib/invitations/context";

export function SignOut({ courier = false }: { courier?: boolean }) {
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
        className="text-button"
        disabled={pending}
        onClick={signOut}
      >
        {pending ? "Saindo…" : "Sair"}
      </button>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
