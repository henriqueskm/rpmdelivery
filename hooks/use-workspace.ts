"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { findRestaurant, type Restaurant } from "@/services/restaurant";
import type { User } from "@supabase/supabase-js";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; user: User; restaurant: Restaurant | null };

export function useWorkspace(destination: "onboarding" | "dashboard") {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const client = getSupabase();
        const { data, error } = await client.auth.getUser();
        if (!active) return;
        if (!data.user) {
          if (
            !error ||
            error.name === "AuthSessionMissingError" ||
            error.status === 401 ||
            error.status === 403
          ) {
            router.replace("/login");
            return;
          }
          throw new Error(
            "Não foi possível verificar seu acesso. Confira sua conexão.",
          );
        }
        const restaurant = await findRestaurant(data.user.id);
        if (!active) return;
        if (destination === "onboarding" && restaurant) {
          router.replace("/dashboard");
          return;
        }
        if (destination === "dashboard" && !restaurant) {
          router.replace("/onboarding");
          return;
        }
        setState({ status: "ready", user: data.user, restaurant });
      } catch (cause) {
        if (active)
          setState({
            status: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "Não foi possível carregar sua conta.",
          });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [attempt, destination, router]);

  useEffect(() => {
    try {
      const { data } = getSupabase().auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") router.replace("/login");
      });
      return () => data.subscription.unsubscribe();
    } catch {
      /* A configuração ausente é apresentada pelo carregamento acima. */
    }
  }, [router]);

  return { state, retry };
}
