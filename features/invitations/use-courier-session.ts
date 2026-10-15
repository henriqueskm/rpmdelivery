"use client";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
export function useCourierSession() {
  const [state, setState] = useState<{ loading: boolean; user: User | null; error: string }>({ loading: true, user: null, error: "" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data, error } = await getSupabase().auth.getUser();
        if (!active) return;
        if (error && error.name !== "AuthSessionMissingError" && error.status !== 401 && error.status !== 403) {
          throw new Error("Não foi possível conferir sua sessão.");
        }
        setState({ loading: false, user: data.user, error: "" });
      } catch {
        if (active) setState({ loading: false, user: null, error: "Não foi possível conferir sua sessão. Tente novamente." });
      }
    }
    void load();
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { data } = getSupabase().auth.onAuthStateChange(event => {
        if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
          setState({ loading: true, user: null, error: "" });
          // Verify outside the Auth callback lock.
          clearTimeout(timer); timer = setTimeout(() => void load(), 0);
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch { /* load() presents missing configuration. */ }
    return () => { active = false; clearTimeout(timer); unsubscribe?.(); };
  }, [attempt]);
  return { ...state, retry };
}
