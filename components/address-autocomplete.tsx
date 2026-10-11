"use client";

import { useId, type KeyboardEvent } from "react";
import { useAddressAutocomplete } from "@/hooks/use-address-autocomplete";
import type { ResolvedAddress } from "@/services/geocoding/types";
import { AddressConfirmationMap } from "./address-confirmation-map";

const messages = {
  idle: "Digite rua, número e cidade. Selecione um endereço para confirmar.",
  searching: "Buscando endereços…",
  results: "Selecione seu endereço na lista.",
  empty: "Nenhum endereço encontrado. Inclua o número e a cidade.",
  error: "Não foi possível confirmar o endereço. Edite a busca e tente novamente.",
  resolving: "Confirmando localização…",
  confirmed: "Localização confirmada. Ao editar, selecione o endereço novamente.",
};

export function AddressAutocomplete({ onChange }: { onChange: (value: ResolvedAddress | null) => void }) {
  const id = useId();
  const listId = `${id}-list`;
  const state = useAddressAutocomplete(onChange);
  const expanded = state.open && state.suggestions.length > 0;
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); state.close(); }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && state.suggestions.length) {
      event.preventDefault();
      state.setOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      state.setActive(state.active < 0 ? (direction === 1 ? 0 : state.suggestions.length - 1)
        : (state.active + direction + state.suggestions.length) % state.suggestions.length);
    }
    if (event.key === "Enter" && !state.resolved) {
      event.preventDefault();
      if (expanded && state.active >= 0) void state.select(state.suggestions[state.active]);
    }
  }
  return (
    <div className="field address-field">
      <label htmlFor={id}>Endereço</label>
      <div className="input-wrap">
        <input id={id} name="address" role="combobox" value={state.query}
          placeholder="Rua, número e cidade" autoComplete="off" maxLength={200} required
          aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId}
          aria-activedescendant={expanded && state.active >= 0 ? `${id}-option-${state.active}` : undefined}
          aria-describedby={`${id}-status`} aria-invalid={state.status === "error"}
          aria-busy={state.status === "searching" || state.status === "resolving"}
          onChange={(event) => state.edit(event.target.value)} onKeyDown={keyDown}
          onBlur={() => state.setOpen(false)} onFocus={() => state.setOpen(true)} />
        {expanded && (
          <ul role="listbox" id={listId} aria-label="Endereços sugeridos" className="address-suggestions">
            {state.suggestions.map((suggestion, index) => (
              <li role="option" id={`${id}-option-${index}`} key={suggestion.id}
                aria-selected={state.active === index} onPointerDown={(event) => event.preventDefault()}
                onClick={() => void state.select(suggestion)}>
                <strong>{suggestion.label}</strong><span>{suggestion.secondaryLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className={`field-hint ${state.status === "error" ? "address-error" : ""}`}
        id={`${id}-status`} role="status" aria-live="polite">{messages[state.status]}</p>
      {state.resolved && <AddressConfirmationMap key={state.resolved.providerId} address={state.resolved} />}
    </div>
  );
}
