import {
  availableCouriers,
  courierLabel,
  plural,
  type DemoState,
} from "./model";
import { Badge, Empty, Icon } from "./ui";
import Link from "next/link";

export function CouriersPanel({ state, managementHref, onReviewShift, pending }: {
  state: DemoState; managementHref?: string;
  /** Real data: the counter approves the shift of a courier who arrived. */
  onReviewShift?: (shiftId: string, approve: boolean) => void; pending?: boolean;
}) {
  const available = availableCouriers(state);
  const rest = state.couriers.filter(
    (c) => !available.some((a) => a.id === c.id),
  );
  return (
    <>
      <div className="ops-panel-heading">
        <h2 id="ops-couriers-title">
          <Icon name="courier" /> Motoboys
        </h2>
        <Badge>{plural(available.length, "disponível", "disponíveis")}</Badge>
      </div>
      {managementHref && <Link href={managementHref} className="text-button">Convites e vínculos</Link>}
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
              <div
                className={`ops-courier ${position === 0 ? "is-next" : ""}`}
                key={c.id}
              >
                <span className="ops-avatar" aria-hidden="true">
                  {c.initials}
                </span>
                <div>
                  <strong dir="auto">{c.name}</strong>
                  <span
                    className={`ops-courier-status status-${label === "Disponível" ? "available" : "other"}`}
                  >
                    {label}
                    {position >= 0 && ` · ${c.availableMinutes} min`}
                  </span>
                  {position === 0 && (
                    <span className="ops-next">Próximo da fila</span>
                  )}
                  {label === "Turno pendente" && (
                    <small>Aguardando aprovação da loja</small>
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
                {position >= 0 && (
                  <span
                    className="ops-queue-number"
                    aria-label={`Posição ${position + 1}`}
                  >
                    {position + 1}
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
