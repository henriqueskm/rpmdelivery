import {
  availableCouriers,
  courierLabel,
  plural,
  type DemoState,
} from "./model";
import { Badge, Empty, Icon } from "./ui";
import Link from "next/link";
import { useRef, type MouseEvent } from "react";

/** One color per moment of the shift; the word stays, so color is never the only signal. */
const statusKey: Record<string, string> = {
  "Disponível": "available", "Reservado": "reserved", "Em rota": "on-route", "Retornando": "returning", "Turno pendente": "pending", "A caminho": "arriving",
};

export function CouriersPanel({ state, managementHref, onReviewShift, onMarkArrived, pending, onPay, onDayClose, onOpenCourier }: {
  state: DemoState; managementHref?: string;
  /** Real data: the name opens the courier card. */
  onOpenCourier?: (id: string, name: string) => void;
  /** Real data: the counter approves the shift of a courier who arrived. */
  onReviewShift?: (shiftId: string, approve: boolean) => void; pending?: boolean;
  /** Real data: an approved courier on the way is at the counter; enters the line now. */
  onMarkArrived?: (shiftId: string) => void;
  /** Real data: rates and the day's settlement. */
  onPay?: () => void;
  /** Real data: "Fechar o dia", ends every shift and saves the day's report. */
  onDayClose?: () => void;
}) {
  const available = availableCouriers(state);
  const menu = useRef<HTMLDetailsElement>(null);
  /** Picking an option closes the menu (its dialog opens on top). */
  function closeOnPick(event: MouseEvent<HTMLDetailsElement>) {
    if ((event.target as HTMLElement).closest(".ops-order-menu-list button, .ops-order-menu-list a") && menu.current)
      menu.current.open = false;
  }
  const rest = state.couriers.filter(
    (c) => !available.some((a) => a.id === c.id),
  );
  return (
    <>
      <div className="ops-panel-heading">
        <h2 id="ops-couriers-title">
          <Icon name="courier" /> Motoboys
        </h2>
        <span className="ops-panel-heading-end">
          <Badge>{plural(available.length, "disponível", "disponíveis")}</Badge>
          {(managementHref || onPay || onDayClose) && (
            // One "⋯" menu for what is not the queue itself: links, rates and the end of the day.
            <details ref={menu} className="ops-order-menu ops-courier-menu" onClick={closeOnPick}>
              <summary aria-label="Opções dos motoboys" title="Convites e vínculos, pagamentos e fechar o dia">
                <span aria-hidden="true">⋯</span>
              </summary>
              <div className="ops-order-menu-list">
                {managementHref && <Link href={managementHref} className="ops-order-menu-item">Convites e vínculos</Link>}
                {onPay && <button type="button" className="ops-order-menu-item" onClick={onPay}>Pagamentos</button>}
                {onDayClose && <button type="button" className="ops-order-menu-item" onClick={onDayClose}>Fechar o dia</button>}
              </div>
            </details>
          )}
        </span>
      </div>
      <div className="ops-courier-caption">Fila por ordem de chegada</div>
      <div
        className="ops-panel-scroll"
        tabIndex={0}
        aria-label="Fila de motoboys"
      >
        {!state.couriers.length ? (
          <Empty title="Nenhum motoboy no turno">
            A disponibilidade depende de vínculo ativo e aprovação do turno.
          </Empty>
        ) : (
          [...available, ...rest].map((c) => {
            const position = available.findIndex((a) => a.id === c.id);
            const label = courierLabel(state, c);
            return (
              // One line per courier, so 15 of them fit without much scrolling: queue position, name and
              // the status pill (the only colored part). Approving a shift adds a second line.
              <div
                className={`ops-courier ${position === 0 ? "is-next" : ""}`}
                key={c.id}
              >
                <div className="ops-courier-line">
                  <span className="ops-queue-number" aria-label={position >= 0 ? `Posição ${position + 1}` : undefined}>
                    {position >= 0 ? `${position + 1}º` : ""}
                  </span>
                  {onOpenCourier
                    ? <button type="button" className="ops-courier-name" dir="auto" title={c.name}
                        aria-label={`Abrir ficha de ${c.name}`} onClick={() => onOpenCourier(c.id, c.name)}>
                        <strong>{c.name}</strong>
                      </button>
                    : <strong dir="auto" title={c.name}>{c.name}</strong>}
                  {/* "1º" and the highlighted row already say it; the word stays for screen readers. */}
                  {position === 0 && <span className="ops-visually-hidden">Próximo da fila</span>}
                  <span className={`ops-courier-status status-${statusKey[label]}`}>
                    <span className="ops-courier-pill">{label}{position >= 0 && ` · ${c.availableMinutes} min`}</span>
                  </span>
                </div>
                {label === "A caminho" && onMarkArrived && (
                  // The courier's GPS usually does it; the counter covers a phone without location.
                  <span className="ops-shift-review">
                    <button disabled={pending} onClick={() => onMarkArrived(c.id)}
                      aria-label={`${c.name} chegou na loja`}>Chegou</button>
                  </span>
                )}
                {label === "Turno pendente" && onReviewShift && (
                  <span className="ops-shift-review">
                    <button className="ops-primary" disabled={pending} onClick={() => onReviewShift(c.id, true)}
                      aria-label={`Aprovar turno de ${c.name}`}>Aprovar</button>
                    <button disabled={pending} onClick={() => onReviewShift(c.id, false)}
                      aria-label={`Recusar turno de ${c.name}`}>Recusar</button>
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="ops-panel-footer">
        Reservados só voltam à fila após a rota e o retorno.
      </div>
    </>
  );
}
