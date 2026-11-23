"use client";
import Link from "next/link";
import { useRef, type MouseEvent, type ReactNode } from "react";
import { Brand } from "@/components/brand";
import type { PrinterStatus } from "./live/use-printer-inbox";

/**
 * The store's side menu, where "Sair" used to be: who is signed in, the other pages of the store and
 * "Sair" (asked first). Operational buttons (pendências, rotas, som) stay on the top line.
 * A native modal dialog: focus stays inside, Escape and a tap outside close it.
 */
const PRINTER_STATUS: Record<PrinterStatus, string> = {
  off: "Desligado. Ligue no computador onde a impressora de teste (RPM Teste) está instalada.",
  waiting: "Procurando o programa da impressora neste computador…",
  connected: "Ligado. Os pedidos impressos aparecem em Pedidos para conferir.",
  unreachable: "O programa da impressora não está aberto neste computador. Abra com npm run print:capture.",
};

export function StoreMenu({ restaurantName, email, storeHref, courierManagementHref, onPay, signOut, printer }: {
  restaurantName: string;
  email?: string;
  storeHref?: string;
  courierManagementHref?: string;
  /** Opens "Pagamentos dos motoboys" (only once the board is loaded). */
  onPay?: () => void;
  /** The control that really signs out, shown in the confirmation. */
  signOut: ReactNode;
  /** Real data: orders read from the printer on this computer (a per-computer choice). */
  printer?: { enabled: boolean; status: PrinterStatus; onToggle: (enabled: boolean) => void };
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const close = () => drawer.current?.close();
  // A click on the dialog itself (not on its content) is a click on the backdrop.
  const outside = (event: MouseEvent<HTMLDialogElement>) => { if (event.target === event.currentTarget) event.currentTarget.close(); };
  return <>
    {/* The name starts with the visible text (WCAG 2.5.3): "Cozinha da Vila, abrir menu". */}
    <button type="button" className="ops-menu-button" aria-haspopup="dialog" aria-label={`${restaurantName}, abrir menu`}
      onClick={() => drawer.current?.showModal()}>
      <span className="ops-menu-store">{restaurantName}</span>
      <span className="ops-menu-icon" aria-hidden="true">☰</span>
    </button>
    <dialog ref={drawer} className="ops-drawer" aria-label="Menu da loja" onClick={outside}>
      <div className="ops-drawer-panel">
        <div className="ops-drawer-head">
          <Brand />
          <button type="button" className="ops-drawer-close" onClick={close} aria-label="Fechar menu">×</button>
        </div>
        <div className="ops-drawer-who">
          <strong>{restaurantName}</strong>
          {email && <small>{email}</small>}
        </div>
        <nav aria-label="Páginas da loja">
          <ul>
            <li><Link href="/dashboard" aria-current="page" onClick={close}>Central de despacho</Link></li>
            {courierManagementHref && <li><Link href={courierManagementHref}>Motoboys e convites</Link></li>}
            {onPay && <li><button type="button" onClick={() => { close(); onPay(); }}>Pagamentos dos motoboys</button></li>}
            {storeHref && <li><Link href={storeHref}>Dados da loja</Link></li>}
          </ul>
        </nav>
        {printer && <div className="ops-drawer-printer">
          <label>
            <input type="checkbox" checked={printer.enabled} aria-describedby="ops-printer-status"
              onChange={event => printer.onToggle(event.currentTarget.checked)} />
            Pedidos da impressora neste computador
          </label>
          <span id="ops-printer-status" className="ops-drawer-printer-status" role="status">{PRINTER_STATUS[printer.status]}</span>
        </div>}
        <div className="ops-drawer-foot">
          <button type="button" onClick={() => confirm.current?.showModal()}>Sair</button>
        </div>
      </div>
      <dialog ref={confirm} className="ops-dialog ops-signout-dialog" aria-labelledby="ops-signout-title" onClick={outside}>
        <h2 id="ops-signout-title">Sair da conta?</h2>
        <p>O painel para de atualizar neste aparelho. Pedidos, rotas e motoboys continuam como estão.</p>
        <div className="ops-signout-actions">
          <button type="button" onClick={() => confirm.current?.close()}>Cancelar</button>
          {signOut}
        </div>
      </dialog>
    </dialog>
  </>;
}
