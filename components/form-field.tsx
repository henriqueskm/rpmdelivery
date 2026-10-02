"use client";

import { useState } from "react";
import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function FormField({ label, hint, id, type, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  const password = type === "password";
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          {...props}
          id={id}
          type={password && visible ? "text" : type}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {password ? (
          <button
            type="button"
            className="password-toggle"
            aria-label={`${visible ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? "Ocultar" : "Mostrar"}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
