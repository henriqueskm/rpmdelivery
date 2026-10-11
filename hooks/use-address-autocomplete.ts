"use client";

import { useEffect, useRef, useState } from "react";
import { resolveAddress, suggestAddress } from "@/services/geocoding/client";
import type { AddressSuggestion, ResolvedAddress } from "@/services/geocoding/types";

type Status = "idle" | "searching" | "results" | "empty" | "error" | "resolving" | "confirmed";

export function useAddressAutocomplete(onChange: (address: ResolvedAddress | null) => void) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [resolved, setResolved] = useState<ResolvedAddress | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.trim().length < 3 || resolved) return;
    const request = new AbortController();
    controller.current = request;
    const timer = setTimeout(async () => {
      if (request.signal.aborted) return;
      setStatus("searching");
      try {
        const items = await suggestAddress(query.trim(), request.signal);
        if (request.signal.aborted) return;
        setSuggestions(items);
        setStatus(items.length ? "results" : "empty");
        setOpen(true);
      } catch {
        if (!request.signal.aborted) setStatus("error");
      }
    }, 300);
    return () => { clearTimeout(timer); request.abort(); };
  }, [query, resolved]);

  useEffect(() => () => controller.current?.abort(), []);

  function edit(value: string) {
    controller.current?.abort();
    setQuery(value);
    setResolved(null);
    onChange(null);
    setSuggestions([]);
    setActive(-1);
    setOpen(false);
    setStatus("idle");
  }

  async function select(suggestion: AddressSuggestion) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setOpen(false);
    setActive(-1);
    setStatus("resolving");
    try {
      const address = await resolveAddress(suggestion.id, request.signal);
      if (request.signal.aborted) return;
      setQuery(address.address);
      setResolved(address);
      onChange(address);
      setSuggestions([]);
      setStatus("confirmed");
    } catch {
      if (!request.signal.aborted) setStatus("error");
    }
  }

  function close() {
    controller.current?.abort();
    setOpen(false);
    setActive(-1);
    if (status === "searching" || status === "resolving") setStatus("idle");
  }

  return { query, status, suggestions, resolved, open, active, edit, select, close, setOpen, setActive };
}
