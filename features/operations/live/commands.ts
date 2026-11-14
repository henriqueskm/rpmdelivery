// Which RPC carries each panel command, and how its errors read to the store.
// Pure: the controller makes the call.

import type { Command } from "../model.ts";
import type { LiveBoard } from "./board.ts";
import { parseBrazilianMobilePhone } from "../../../lib/brazilian-mobile-phone.ts";

/** Panel commands that only exist with real data. */
export type StoreCommand =
  | { type: "review-shift"; shiftId: string; approve: boolean }
  | { type: "cancel-route"; routeId: string }
  | { type: "cancel-order"; orderId: string }
  | { type: "requeue"; orderId: string };

export type RpcCall = { fn: string; args: Record<string, unknown> };

const blank = (value: string) => value.trim() || null;

/**
 * The RPC for a command, or null when it has no server side (alert receipts
 * stay on this device). `requestId` makes creations safe to repeat.
 */
export function rpcFor(command: Command | StoreCommand, restaurantId: string, board: LiveBoard, requestId: string): RpcCall | null {
  const restaurant = { p_restaurant_id: restaurantId };
  switch (command.type) {
    case "add": {
      const { order } = command;
      return { fn: "create_order", args: { ...restaurant, p_request_id: requestId,
        p_customer_name: order.customer.trim(), p_customer_phone: parseBrazilianMobilePhone(order.phone),
        p_delivery_address: order.address.trim(), p_neighborhood: blank(order.neighborhood),
        p_complement: blank(order.complement), p_reference: blank(order.reference), p_notes: blank(order.notes),
        p_ordered_at: new Date(order.orderedAt).toISOString(), p_promised_minutes: order.promisedMinutes } };
    }
    case "assign":
      return command.editingId
        ? { fn: "update_route_composition", args: { ...restaurant, p_route_id: command.editingId,
          p_expected_version: board.versions[command.editingId], p_delivery_ids: command.ids } }
        : { fn: "create_route", args: { ...restaurant, p_request_id: requestId,
          p_shift_id: command.courierId, p_delivery_ids: command.ids } };
    case "release":
      return { fn: "release_route_pickup", args: { ...restaurant, p_route_id: command.routeId,
        p_expected_version: board.versions[command.routeId] } };
    case "revoke-release":
      return { fn: "revoke_route_pickup", args: { ...restaurant, p_route_id: command.routeId } };
    case "cancel-route":
      return { fn: "cancel_route", args: { ...restaurant, p_route_id: command.routeId } };
    case "issue-decide": {
      const issue = board.state.issues.find(item => item.id === command.issueId);
      return issue ? { fn: "decide_delivery_failure", args: { ...restaurant,
        p_delivery_id: issue.orderId, p_decision: command.decision } } : null;
    }
    case "delivery-cancel":
      return { fn: "cancel_delivery_on_route", args: { ...restaurant, p_delivery_id: command.orderId } };
    case "review-shift":
      return { fn: "review_shift", args: { ...restaurant, p_shift_id: command.shiftId, p_approve: command.approve } };
    case "cancel-order": {
      // The panel knows deliveries; cancel_order takes the order behind it.
      const orderId = board.orderIds[command.orderId];
      return orderId ? { fn: "cancel_order", args: { ...restaurant, p_order_id: orderId } } : null;
    }
    case "requeue":
      return { fn: "requeue_delivery", args: { ...restaurant, p_delivery_id: command.orderId } };
    default:
      return null;
  }
}

/** Commands of the prototype that real data does not support yet. */
export function supportedLive(command: Command | StoreCommand) {
  return ["add", "assign", "release", "revoke-release", "cancel-route", "issue-decide", "delivery-cancel",
    "review-shift", "cancel-order", "requeue", "alert-view", "alert-dismiss"].includes(command.type);
}

const MESSAGES: Record<string, string> = {
  RPM_MANAGER_REQUIRED: "Só o dono ou o gerente da loja altera o pagamento dos motoboys.",
  RPM_ORDER_NOT_CANCELLABLE: "Esse pedido já saiu da fila de despacho. O painel foi atualizado.",
  RPM_DELIVERY_IN_TRANSIT: "O pedido volta para a fila quando o motoboy chegar na loja.",
  RPM_PAY_FIELDS: "Informe valores de R$ 0 a R$ 1.000.",
  RPM_ROUTE_STALE: "A rota mudou em outro aparelho. O painel foi atualizado; confira e tente de novo.",
  RPM_ROUTE_STATE: "A rota já mudou de situação. O painel foi atualizado.",
  RPM_ROUTE_NOT_FOUND: "Essa rota não existe mais. O painel foi atualizado.",
  RPM_DELIVERY_UNAVAILABLE: "Algum pedido já entrou em outra rota ou mudou. O painel foi atualizado.",
  RPM_DELIVERY_STATE: "A entrega já mudou de situação. O painel foi atualizado.",
  RPM_DELIVERY_NOT_FOUND: "Esse pedido não foi encontrado. O painel foi atualizado.",
  RPM_ISSUE_CLOSED: "Essa ocorrência já foi resolvida. O painel foi atualizado.",
  RPM_ISSUE_NOT_FOUND: "Essa ocorrência não foi encontrada. O painel foi atualizado.",
  RPM_SHIFT_NOT_AVAILABLE: "Esse motoboy não está mais disponível. O painel foi atualizado.",
  RPM_SHIFT_NOT_FOUND: "Esse turno não existe mais. O painel foi atualizado.",
  RPM_COURIER_BUSY: "Esse motoboy já tem outra rota. O painel foi atualizado.",
  RPM_COURIER_LINK_REQUIRED: "O vínculo desse motoboy com a loja não está ativo.",
  RPM_ROUTE_FIELDS: "Uma rota leva de 1 a 30 pedidos, sem repetir.",
  RPM_ORDER_FIELDS: "Confira os dados do pedido: nome, celular, endereço, horário e prazo.",
  RPM_MEMBER_REQUIRED: "Sua conta não tem mais acesso a esta loja.",
  RPM_AUTH_REQUIRED: "Sua sessão terminou. Entre de novo para continuar.",
};

/** Store-facing text for an RPC error (PostgREST puts the RPM_ code in `message`). */
export function errorMessage(error: { message?: string } | null | undefined) {
  const code = error?.message?.match(/RPM_[A-Z_]+/)?.[0];
  return (code && MESSAGES[code]) ?? "Não foi possível concluir agora. Confira a conexão e tente de novo.";
}
