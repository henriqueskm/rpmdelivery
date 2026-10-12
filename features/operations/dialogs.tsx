import { useRef, type FormEvent, type RefObject } from "react";
import { isValidBrazilianMobilePhone } from "@/lib/brazilian-mobile-phone";
import { type Command, type DemoState, type NewOrder } from "./model";
import { RouteBadge } from "./ui";

export function NewOrderDialog({
  dialogRef,
  onAdd,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  onAdd: (order: NewOrder) => void;
}) {
  const phoneRef = useRef<HTMLInputElement>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    for (const name of ["customer", "phone", "address", "neighborhood"]) {
      const field = form.elements.namedItem(name) as HTMLInputElement;
      field.value = value(name);
    }
    if (!form.reportValidity()) return;
    if (!isValidBrazilianMobilePhone(value("phone"))) {
      phoneRef.current?.setCustomValidity(
        "Informe um celular fictício com DDD e 9 dígitos.",
      );
      phoneRef.current?.reportValidity();
      return;
    }
    onAdd({
      reference: value("reference"),
      customer: value("customer"),
      phone: value("phone"),
      address: value("address"),
      neighborhood: value("neighborhood"),
      complement: value("complement"),
      notes: value("notes"),
    });
    dialogRef.current?.close();
    form.reset();
  }
  return (
    <dialog
      ref={dialogRef}
      className="ops-dialog"
      aria-labelledby="ops-new-title"
    >
      <div className="ops-dialog-heading">
        <div>
          <span className="ops-kicker">CADASTRO DEMONSTRATIVO</span>
          <h2 id="ops-new-title">Novo pedido</h2>
        </div>
        <button
          type="button"
          aria-label="Fechar novo pedido"
          onClick={() => dialogRef.current?.close()}
        >
          ×
        </button>
      </div>
      <p className="ops-dialog-notice">
        Use apenas dados fictícios. Nada será salvo ou enviado.
      </p>
      <form onSubmit={submit} className="ops-order-form">
        <label>
          Nome do cliente
          <input name="customer" required maxLength={120} autoComplete="off" />
        </label>
        <label>
          WhatsApp
          <input
            name="phone"
            ref={phoneRef}
            required
            type="tel"
            inputMode="tel"
            placeholder="(11) 90000-0000"
            maxLength={24}
            autoComplete="off"
            onInput={() => phoneRef.current?.setCustomValidity("")}
          />
        </label>
        <label className="ops-form-wide">
          Endereço
          <input
            name="address"
            required
            maxLength={240}
            autoComplete="off"
            placeholder="Rua e número"
          />
        </label>
        <label>
          Bairro
          <input
            name="neighborhood"
            required
            maxLength={120}
            autoComplete="off"
          />
        </label>
        <label>
          Número / referência (opcional)
          <input name="reference" maxLength={40} autoComplete="off" />
        </label>
        <label className="ops-form-wide">
          Complemento / referência
          <input
            name="complement"
            maxLength={240}
            autoComplete="off"
            placeholder="Apartamento, portaria ou ponto de referência"
          />
        </label>
        <label className="ops-form-wide">
          Observações
          <textarea
            name="notes"
            rows={3}
            maxLength={500}
            placeholder="O que o motoboy precisa saber?"
          />
        </label>
        <div className="ops-form-wide ops-form-footer">
          <span>Entra em Aguardando despacho.</span>
          <button type="submit" className="ops-primary">
            Cadastrar pedido (demo)
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function CourierDialog({
  dialogRef,
  state,
  routeId,
  onCommand,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  state: DemoState;
  routeId?: string;
  onCommand: (command: Command) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const route = state.routes.find((r) => r.id === routeId);
  const courier = state.couriers.find((c) => c.id === route?.courierId);
  const hasIssue = state.orders.some(
    (o) => route?.orderIds.includes(o.id) && o.delivery === "ATTEMPT_FAILED",
  );
  return (
    <dialog
      ref={dialogRef}
      className="ops-dialog ops-courier-dialog"
      aria-labelledby="ops-courier-view-title"
    >
      <div className="ops-dialog-heading">
        <div>
          <span className="ops-kicker">VISÃO SEPARADA • DEMONSTRAÇÃO</span>
          <h2 id="ops-courier-view-title">Aplicativo do motoboy</h2>
        </div>
        <button
          ref={closeRef}
          aria-label="Fechar visão do motoboy"
          onClick={() => dialogRef.current?.close()}
        >
          ×
        </button>
      </div>
      {route && courier && (
        <>
          <p className="ops-dialog-notice">
            Simulação local, sem autenticação do motoboy, tracking ou
            notificações. As ações reais exigirão validação no backend.
          </p>
          <div className="ops-courier-route">
            <strong>
              {courier.name} · {route.reference}
            </strong>
            <RouteBadge status={route.status} />
          </div>
          <ol className="ops-courier-deliveries">
            {route.orderIds.map((id) => {
              const o = state.orders.find((o) => o.id === id)!;
              return (
                <li key={id}>
                  <strong>
                    #{o.reference} · {o.customer}
                  </strong>
                  <span>
                    {o.address} · {o.neighborhood}
                  </span>
                  {o.complement && <span>{o.complement}</span>}
                  {o.notes && <p>{o.notes}</p>}
                </li>
              );
            })}
          </ol>
          {route.status === "PREPARING" && (
            <p>
              Confira os pedidos atribuídos. O início depende de uma ação sua.
            </p>
          )}
          {route.status === "ON_ROUTE" && (
            <>
              <p>
                Rota iniciada pelo motoboy. A composição e a sequência estão
                bloqueadas.
              </p>
              {hasIssue && (
                <p className="ops-dialog-notice">
                  Resolva a ocorrência com a loja antes de concluir. Essa
                  decisão não está implementada na demonstração.
                </p>
              )}
            </>
          )}
          {route.status === "RETURNING" && (
            <p>
              Entregas concluídas. Você só volta à fila depois de confirmar que
              retornou ao restaurante.
            </p>
          )}
          {route.status !== "COMPLETED" && (
            <button
              className="ops-primary"
              disabled={route.status === "ON_ROUTE" && hasIssue}
              onClick={() => {
                if (route.status === "RETURNING") closeRef.current?.focus();
                onCommand({
                  type:
                    route.status === "PREPARING"
                      ? "start"
                      : route.status === "ON_ROUTE"
                        ? "finish"
                        : "arrive",
                  routeId: route.id,
                  actorId: courier.id,
                });
              }}
            >
              {
                {
                  PREPARING: "Iniciar rota — simulação",
                  ON_ROUTE: "Simular entregas concluídas",
                  RETURNING: "Confirmar retorno — simulação",
                }[route.status]
              }
            </button>
          )}
          {route.status === "COMPLETED" && (
            <p role="status">
              Retorno confirmado. Você entrou no final da fila de disponíveis.
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
