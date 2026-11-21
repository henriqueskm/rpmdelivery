"use client";
import { useEffect, useRef } from "react";
import type { DemoOrder } from "./model";
import { CopyTrackingLink } from "./copy-tracking-link";

/**
 * Real data: what the store can do with an order waiting for dispatch, behind one "⋯" button so the
 * row stays one line: edit it, copy the customer's tracking link, cancel it. Closes on Escape, on a
 * click elsewhere and after editing or cancelling.
 */
export function OrderActions({ order, pending, onEdit, onCancel }: {
  order: DemoOrder;
  pending: boolean;
  onEdit?: (id: string) => void;
  onCancel?: (id: string) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const outside = (event: PointerEvent) => { if (element.open && !element.contains(event.target as Node)) element.open = false; };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !element.open) return;
      element.open = false;
      element.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    element.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); element.removeEventListener("keydown", escape); };
  }, []);
  const waiting = order.delivery === "WAITING";
  const close = () => { if (menu.current) menu.current.open = false; };
  if (!waiting && !order.trackingToken) return null;
  return (
    <details ref={menu} className="ops-order-menu">
      <summary aria-label={`Ações do pedido ${order.reference}`} title="Editar, copiar link ou cancelar">
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="ops-order-menu-list">
        {onEdit && waiting && <button type="button" disabled={pending} aria-label={`Editar pedido ${order.reference}`}
          onClick={() => { close(); onEdit(order.id); }}>Editar pedido</button>}
        <CopyTrackingLink token={order.trackingToken} reference={order.reference} className="ops-order-menu-item" />
        {onCancel && waiting && <button type="button" className="is-danger" disabled={pending}
          aria-label={`Cancelar pedido ${order.reference}`}
          onClick={() => { close(); onCancel(order.id); }}>Cancelar pedido</button>}
      </div>
    </details>
  );
}
