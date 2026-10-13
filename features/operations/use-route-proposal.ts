import { useEffect, useRef, useState } from "react";
import { optimizeSequence } from "../route-optimization/optimize";
import { OptimizationError, type Comparison, type OptimizationInput } from "../route-optimization/types";

type Job = { key: string; status: "pending" | "done" | "error"; result?: Comparison; error?: string };
export function useRouteProposal() {
  const [job, setJob] = useState<Job>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function calculate(key: string, makeInput: () => OptimizationInput) {
    clearTimeout(timer.current);
    setJob({ key, status: "pending" });
    // Explicit simulated provider latency; only after requesting a suggestion.
    timer.current = setTimeout(() => {
      try {
        const result = optimizeSequence(makeInput());
        setJob(current => current?.key === key && current.status === "pending" ? { key, status: "done", result } : current);
      } catch(error) {
        const code = error instanceof OptimizationError ? error.code : "unavailable";
        setJob(current => current?.key === key && current.status === "pending" ? { key, status: "error", error: code } : current);
      }
    }, 150);
  }
  return { job, calculate };
}
