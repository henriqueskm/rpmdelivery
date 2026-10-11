import { useState } from "react";
import { editableOrders, normalized, plural, type DemoState } from "./model";
import { Badge, Empty, Icon } from "./ui";

export function OrdersPanel({
  state,
  selected,
  editingId,
  onSelect,
}: {
  state: DemoState;
  selected: string[];
  editingId?: string;
  onSelect: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [notesOnly, setNotesOnly] = useState(false);
  const [page, setPage] = useState(0);
  const orders = editableOrders(state, editingId);
  const filtered = orders.filter(
    (o) =>
      normalized(`${o.reference} ${o.customer} ${o.neighborhood}`).includes(
        normalized(search),
      ) &&
      (!notesOnly || o.notes),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / 20) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * 20, currentPage * 20 + 20);
  const allSelected =
    visible.length > 0 && visible.every((o) => selected.includes(o.id));
  function toggle(id: string) {
    onSelect(
      selected.includes(id)
        ? selected.filter((i) => i !== id)
        : [...selected, id],
    );
  }
  return (
    <>
      <div className="ops-panel-heading">
        <h2 id="ops-orders-title">
          <Icon name="orders" /> Aguardando despacho
        </h2>
        <Badge>{orders.length}</Badge>
      </div>
      <div className="ops-filters">
        <label className="ops-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Buscar pedidos"
            placeholder="Pedido, cliente ou bairro"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="ops-filter-check">
          <input
            type="checkbox"
            checked={notesOnly}
            onChange={(e) => {
              setNotesOnly(e.target.checked);
              setPage(0);
            }}
          />{" "}
          Com observação
        </label>
      </div>
      <div className="ops-list-toolbar">
        <label>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={!visible.length}
            onChange={() =>
              onSelect(
                allSelected
                  ? selected.filter((id) => !visible.some((o) => o.id === id))
                  : [...new Set([...selected, ...visible.map((o) => o.id)])],
              )
            }
          />{" "}
          Selecionar visíveis
        </label>
        <span>{selected.length} selecionados</span>
      </div>
      <div
        className="ops-panel-scroll"
        tabIndex={0}
        aria-label="Lista de pedidos"
      >
        {!visible.length ? (
          <Empty
            title={
              orders.length ? "Nenhum resultado" : "Nenhum pedido aguardando"
            }
          >
            {orders.length
              ? "Ajuste a busca ou o filtro para encontrar o pedido."
              : "Cadastre um pedido fictício para experimentar o despacho."}
          </Empty>
        ) : (
          visible.map((o) => (
            <label
              className={`ops-order ${selected.includes(o.id) ? "is-selected" : ""}`}
              key={o.id}
            >
              <input
                type="checkbox"
                aria-label={`Selecionar pedido ${o.reference}`}
                checked={selected.includes(o.id)}
                onChange={() => toggle(o.id)}
              />
              <span className="ops-order-content">
                <span className="ops-order-top">
                  <span className="ops-order-identity">
                    <strong className="ops-order-ref">#{o.reference}</strong>
                    <span className="ops-customer" dir="auto">
                      {o.customer}
                    </span>
                  </span>
                  <time>
                    {o.waitMinutes === 0 ? "Agora" : `${o.waitMinutes} min`}
                  </time>
                </span>
                <span className="ops-destination">{o.neighborhood}</span>
                {o.notes && (
                  <span className="ops-order-note">
                    <span aria-hidden="true">!</span>
                    {o.notes}
                  </span>
                )}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="ops-panel-footer">
        <span>
          {plural(filtered.length, "pedido", "pedidos")}
          {editingId && " • Inclui a rota em edição"}
        </span>
        {lastPage > 0 && (
          <div className="ops-pagination">
            <button
              aria-label="Página anterior"
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            >
              ←
            </button>
            <span>
              {currentPage + 1}/{lastPage + 1}
            </span>
            <button
              aria-label="Próxima página"
              disabled={currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
