"use client";

import { useEffect, useRef } from "react";

export type Confirmation = { title: string; body: string; action: string; run: () => void };

/** Asks once before a store action that cannot be undone (cancel a route or an order). */
export function ConfirmDialog({ request, onClose }: { request: Confirmation | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);
  return (
    <dialog ref={ref} className="ops-dialog ops-confirm" aria-labelledby="ops-confirm-title"
      aria-describedby="ops-confirm-body" onClose={onClose}>
      <h2 id="ops-confirm-title">{request?.title}</h2>
      <p id="ops-confirm-body">{request?.body}</p>
      <div className="ops-confirm-actions">
        <button type="button" onClick={() => ref.current?.close()}>Voltar</button>
        <button type="button" className="ops-danger" onClick={() => { request?.run(); ref.current?.close(); }}>
          {request?.action}
        </button>
      </div>
    </dialog>
  );
}
