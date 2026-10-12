import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { availableCouriers, plural, type DemoState } from "./model";
import { Badge, Empty, Icon, RouteBadge } from "./ui";

type BuilderProps = {
  state: DemoState;
  selected: string[];
  editingId?: string;
  courierId: string;
  onCourier: (id: string) => void;
  onSelect: (ids: string[]) => void;
  onAssign: () => void;
  onCancel: () => void;
};

export function BuilderPanel(props: BuilderProps) {
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (expanded && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      dialog.current.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (!expanded && returnFocus.current) {
      expandButton.current?.focus();
      returnFocus.current = false;
    }
  }, [expanded]);
  return (
    <>
      {!expanded && (
        <BuilderContent
          {...props}
          expandButton={expandButton}
          onExpand={() => {
            returnFocus.current = true;
            setExpanded(true);
          }}
        />
      )}
      <dialog
        ref={dialog}
        className="ops-conference"
        aria-label="Conferir montagem"
        onClose={() => setExpanded(false)}
      >
        {expanded && (
          <>
            <div className="ops-conference-demo">
              Demonstração · dados fictícios, sem persistência.
            </div>
            <BuilderContent
              {...props}
              onClose={() => dialog.current?.close()}
              onAssign={() => {
                returnFocus.current = false;
                dialog.current?.close();
                props.onAssign();
              }}
            />
          </>
        )}
      </dialog>
    </>
  );
}

function BuilderContent({
  state,
  selected,
  editingId,
  courierId,
  onCourier,
  onSelect,
  onAssign,
  onCancel,
  onExpand,
  onClose,
  expandButton,
}: BuilderProps & {
  onExpand?: () => void;
  onClose?: () => void;
  expandButton?: RefObject<HTMLButtonElement | null>;
}) {
  const courierInputId = useId();
  const editing = state.routes.find((r) => r.id === editingId);
  const couriers = editing
    ? state.couriers.filter((c) => c.id === editing.courierId)
    : availableCouriers(state);
  const chosen = couriers.some((c) => c.id === courierId)
    ? courierId
    : (couriers[0]?.id ?? "");
  function move(index: number, direction: number) {
    const next = [...selected];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    onSelect(next);
  }
  return (
    <>
      <div className="ops-panel-heading ops-builder-heading">
        <h2 id="ops-builder-title">
          <Icon name="route" /> Montagem de rota
        </h2>
        {editing && <Badge>{editing.reference}</Badge>}
        {onExpand && (
          <button
            ref={expandButton}
            className="ops-expand"
            aria-label="Ampliar conferência da rota"
            onClick={onExpand}
          >
            Conferir ↗
          </button>
        )}
        {onClose && (
          <button aria-label="Fechar conferência" onClick={onClose}>×</button>
        )}
      </div>
      <div className="ops-builder-summary">
        <RouteBadge status="PREPARING" />
        <span>{plural(selected.length, "entrega", "entregas")}</span>
      </div>
      <div
        className="ops-panel-scroll"
        tabIndex={0}
        aria-label="Sequência planejada"
      >
        {!selected.length ? (
          <Empty title="Monte a próxima saída">
            Selecione pedidos na área Pedidos. A sequência pode ser ajustada
            antes do início.
          </Empty>
        ) : (
          <ol className="ops-sequence">
            {selected.map((id, index) => {
              const o = state.orders.find((o) => o.id === id)!;
              return (
                <li key={id}>
                  <span className="ops-stop-number">{index + 1}</span>
                  <div className="ops-stop-content">
                    <strong>
                      #{o.reference} · {o.customer}
                    </strong>
                    <span>{o.neighborhood}</span>
                  </div>
                  {onClose && <p className="ops-stop-address">{o.address}</p>}
                  {o.complement && (
                    <p className="ops-stop-reference">
                      <strong>Referência:</strong> {o.complement}
                    </p>
                  )}
                  {o.notes && (
                    <p className="ops-stop-note">
                      <strong>Observação:</strong> {o.notes}
                    </p>
                  )}
                  <div className="ops-sequence-controls">
                    <button
                      aria-label={`Mover pedido ${o.reference} para cima`}
                      disabled={!index}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Mover pedido ${o.reference} para baixo`}
                      disabled={index === selected.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      aria-label={`Remover pedido ${o.reference} da montagem`}
                      onClick={() => onSelect(selected.filter((i) => i !== id))}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="ops-builder-actions">
        <label htmlFor={courierInputId}>
          Motoboy {editing ? "reservado" : "disponível"}
        </label>
        <select
          id={courierInputId}
          value={chosen}
          disabled={!!editing || !couriers.length}
          onChange={(e) => onCourier(e.target.value)}
        >
          {!couriers.length && <option value="">Nenhum disponível</option>}
          {couriers.map((c, i) => (
            <option value={c.id} key={c.id}>
              {c.name}
              {!editing && i === 0 ? " · próximo da fila" : ""}
            </option>
          ))}
        </select>
        <p>
          Motoboy reservado após atribuir.{" "}
          <strong>Somente ele inicia a rota.</strong>
        </p>
        <div className="ops-assign-buttons">
          <button
            className="ops-primary"
            disabled={!selected.length || !chosen}
            onClick={onAssign}
          >
            {editing ? "Salvar montagem (demo)" : "Atribuir rota (demo)"}
            <span aria-hidden="true">→</span>
          </button>
          {(editing || selected.length > 0) && (
            <button className="ops-link-button" onClick={onCancel}>
              {editing ? "Cancelar edição" : "Limpar seleção"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
