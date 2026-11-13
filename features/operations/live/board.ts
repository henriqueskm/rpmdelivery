// Turns get_operations_board into the state the operations screens already
// render. Pure: no Supabase, no React.

import type { DemoCourier, DemoOrder, DemoRoute, DemoState, RouteStatus, ShiftStatus } from "../model.ts";
import type { AlertReceipt, DeliveryStatus, DemoIssue, IssueReason, IssueResolution } from "../issue-types.ts";
import { formatBrazilianMobilePhone } from "../../../lib/brazilian-mobile-phone.ts";

type BoardOrder = {
  deliveryId: string; orderId: string; reference: string; customer: string; phone: string;
  address: string; neighborhood: string | null; complement: string | null; notes: string | null;
  orderedAt: string; createdAt: string; promisedMinutes: number;
  orderStatus: DemoOrder["status"]; deliveryStatus: DeliveryStatus; failedAttempts: number;
};
type BoardCourier = {
  shiftId: string; name: string; status: ShiftStatus; linkActive: boolean;
  requestedAt: string; availableSince: string | null;
};
type BoardRoute = {
  id: string; reference: string; shiftId: string; status: RouteStatus; compositionVersion: number;
  pickupReleasedAt: string | null; deliveryIds: string[]; retryDeliveryIds: string[];
};
type BoardIssue = {
  id: string; deliveryId: string; routeId: string; attempt: number; reason: IssueReason;
  notes: string | null; reportedAt: string; decisionDeadline: string;
  decision: IssueResolution | null; decidedAt: string | null; decidedBy: string | null;
};
export type Board = {
  serverNow: string;
  restaurant: { defaultPromiseMinutes: number; issueTimeoutMinutes: number };
  couriers: BoardCourier[]; routes: BoardRoute[]; orders: BoardOrder[]; issues: BoardIssue[];
};

/** What the commands need beyond the rendered state. */
export type LiveBoard = {
  state: DemoState;
  /** Route id → composition version the store last saw (stale edits are refused). */
  versions: Record<string, number>;
  /** Delivery id → order id. */
  orderIds: Record<string, string>;
  /** Server clock minus device clock, in ms. */
  clockOffset: number;
};

const ORDER_STATUSES = ["OPEN", "DELIVERING", "DELIVERED", "CANCELLED"];
const DELIVERY_STATUSES = ["WAITING", "ASSIGNED", "ON_ROUTE", "NEXT", "ATTEMPT_FAILED", "RETURN_TO_STORE", "DELIVERED", "CANCELLED"];
const SHIFT_STATUSES = ["PENDING", "AVAILABLE", "ON_ROUTE", "RETURNING"];
const ROUTE_STATUSES = ["PREPARING", "ON_ROUTE", "RETURNING", "COMPLETED"];
const REASONS = ["CUSTOMER_NOT_FOUND", "CUSTOMER_NOT_RESPONDING", "ADDRESS_PROBLEM", "OTHER"];
const DECISIONS = ["RETRY", "RETURN", "CANCEL", "TIMEOUT", "OTHERS_FINISHED"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isOptionalText = (value: unknown) => value === null || isText(value);
const isTime = (value: unknown) => isText(value) && !Number.isNaN(Date.parse(value));
const isOptionalTime = (value: unknown) => value === null || isTime(value);
const isCount = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;
const isIdList = (value: unknown) => Array.isArray(value) && value.every(isText);
const oneOf = (values: string[]) => (value: unknown) => isText(value) && values.includes(value);
const list = (value: unknown, valid: (item: Record<string, unknown>) => boolean) =>
  Array.isArray(value) && value.every(item => isRecord(item) && valid(item));

/** Narrows the RPC answer; anything unexpected is refused as a whole. */
export function parseBoard(value: unknown): Board | null {
  if (!isRecord(value) || !isTime(value.serverNow) || !isRecord(value.restaurant)) return null;
  const { restaurant } = value;
  if (!isCount(restaurant.defaultPromiseMinutes) || !isCount(restaurant.issueTimeoutMinutes)) return null;
  const valid =
    list(value.couriers, c => isText(c.shiftId) && isText(c.name) && oneOf(SHIFT_STATUSES)(c.status)
      && typeof c.linkActive === "boolean" && isTime(c.requestedAt) && isOptionalTime(c.availableSince))
    && list(value.routes, r => isText(r.id) && isText(r.reference) && isText(r.shiftId)
      && oneOf(ROUTE_STATUSES)(r.status) && isCount(r.compositionVersion) && isOptionalTime(r.pickupReleasedAt)
      && isIdList(r.deliveryIds) && isIdList(r.retryDeliveryIds))
    && list(value.orders, o => isText(o.deliveryId) && isText(o.orderId) && isText(o.reference)
      && isText(o.customer) && isText(o.phone) && isText(o.address) && isOptionalText(o.neighborhood)
      && isOptionalText(o.complement) && isOptionalText(o.notes) && isTime(o.orderedAt) && isTime(o.createdAt)
      && isCount(o.promisedMinutes) && oneOf(ORDER_STATUSES)(o.orderStatus)
      && oneOf(DELIVERY_STATUSES)(o.deliveryStatus) && isCount(o.failedAttempts))
    && list(value.issues, i => isText(i.id) && isText(i.deliveryId) && isText(i.routeId) && isCount(i.attempt)
      && oneOf(REASONS)(i.reason) && isOptionalText(i.notes) && isTime(i.reportedAt) && isTime(i.decisionDeadline)
      && (i.decision === null || oneOf(DECISIONS)(i.decision)) && isOptionalTime(i.decidedAt)
      && isOptionalText(i.decidedBy));
  return valid ? value as Board : null;
}

const ms = (iso: string) => Date.parse(iso);

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters.map(word => word[0]).join("").toLocaleUpperCase("pt-BR") || "?";
}

type When = {
  /** Device time to render for. */
  now: number;
  /** Device time when the board arrived; with serverNow it gives the clock offset. */
  receivedAt?: number;
  alertReceipts?: Record<string, AlertReceipt>;
};

/**
 * The board as the screens expect it, at device time `now`. An occurrence
 * past its deadline is shown as already returning to the store: the server
 * closes it on the courier's next command (no worker), and nobody can decide
 * it anymore.
 */
export function boardToState(board: Board, { now, receivedAt = now, alertReceipts = {} }: When): LiveBoard {
  const clockOffset = ms(board.serverNow) - receivedAt;
  const serverNow = now + clockOffset;
  const shiftOf = new Map(board.routes.map(route => [route.id, route.shiftId]));
  const expired = new Set(board.issues
    .filter(issue => issue.decision === null && ms(issue.decisionDeadline) <= serverNow)
    .map(issue => issue.deliveryId));

  const orders: DemoOrder[] = board.orders.map(order => {
    const delivery = expired.has(order.deliveryId) ? "RETURN_TO_STORE" : order.deliveryStatus;
    const onTheWay = delivery === "ON_ROUTE" || delivery === "NEXT";
    return {
      id: order.deliveryId,
      reference: order.reference,
      customer: order.customer,
      phone: formatBrazilianMobilePhone(order.phone),
      address: order.address,
      neighborhood: order.neighborhood ?? "",
      complement: order.complement ?? "",
      notes: order.notes ?? "",
      orderedAt: ms(order.orderedAt),
      createdAt: ms(order.createdAt),
      promisedMinutes: order.promisedMinutes,
      status: order.orderStatus,
      delivery,
      attemptNumber: Math.max(1, order.failedAttempts + (onTheWay ? 1 : 0)),
    };
  });

  const couriers: DemoCourier[] = board.couriers.map((courier, index) => ({
    id: courier.shiftId,
    name: courier.name,
    initials: initials(courier.name),
    shift: courier.status,
    activeLink: courier.linkActive,
    queueOrder: index,
    availableMinutes: courier.availableSince
      ? Math.max(0, Math.floor((serverNow - ms(courier.availableSince)) / 60_000)) : 0,
  }));

  const routes: DemoRoute[] = board.routes.map(route => ({
    id: route.id,
    reference: route.reference,
    courierId: route.shiftId,
    orderIds: route.deliveryIds,
    status: route.status,
    pickupReleasedAt: route.pickupReleasedAt ? ms(route.pickupReleasedAt) : null,
    retryOrderIds: route.retryDeliveryIds,
  }));

  const issues: DemoIssue[] = board.issues.map(issue => {
    const timedOut = issue.decision === null && expired.has(issue.deliveryId);
    const resolution = issue.decision ?? (timedOut ? "TIMEOUT" : undefined);
    return {
      id: issue.id,
      orderId: issue.deliveryId,
      routeId: issue.routeId,
      courierId: shiftOf.get(issue.routeId) ?? "",
      attempt: issue.attempt,
      reason: issue.reason,
      description: issue.notes ?? "",
      reportedAt: ms(issue.reportedAt),
      decisionDeadline: ms(issue.decisionDeadline),
      status: resolution ? "CLOSED" : "PENDING",
      ...(resolution ? {
        resolution,
        closedAt: issue.decidedAt ? ms(issue.decidedAt) : ms(issue.decisionDeadline),
        ...(issue.decidedBy ? { decidedBy: issue.decidedBy } : {}),
      } : {}),
    };
  });

  return {
    state: {
      issueTimeoutMinutes: board.restaurant.issueTimeoutMinutes,
      defaultPromiseMinutes: board.restaurant.defaultPromiseMinutes,
      issues,
      events: [],
      commandIds: [],
      alertReceipts,
      orders,
      couriers,
      routes,
      nextOrder: 0,
      nextRoute: 0,
      nextQueue: couriers.length,
    },
    versions: Object.fromEntries(board.routes.map(route => [route.id, route.compositionVersion])),
    orderIds: Object.fromEntries(board.orders.map(order => [order.deliveryId, order.orderId])),
    clockOffset,
  };
}
