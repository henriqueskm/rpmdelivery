import type { DemoState } from "./model.ts";
import { DEMO_STORE_ACTOR, ISSUE_REASONS, deliveryEligible, validIssueTime, validIssueTimeout, type IssueCommand } from "./issue-types.ts";
import { closeIssue, recordEvent } from "./issue-events.ts";
import { nextDelivery, progressRoute, settleIssues } from "./route-progress.ts";

export function issueReducer(state: DemoState, command: IssueCommand): DemoState {
  if (!validIssueTime(command.now)) return state;
  if (command.type === "issues-tick") return settleIssues(state, command.now);
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(command.commandId) || state.commandIds.includes(command.commandId)) return state;
  const driverAction = command.type === "delivery-complete" || command.type === "delivery-failure";
  if (!driverAction && command.actorId !== DEMO_STORE_ACTOR) return state;
  if (driverAction) {
    const route = state.routes.find(r => r.id === command.routeId && r.status === "ON_ROUTE");
    const courier = state.couriers.find(c => c.id === command.actorId && c.activeLink && c.shift === "ON_ROUTE");
    const order = route && nextDelivery(state, route);
    if (!route || !courier || route.courierId !== courier.id || !order || order.id !== command.orderId ||
      (order.attemptNumber ?? 1) !== command.expectedAttempt || command.now < order.createdAt ||
      state.events.some(e=>e.routeId===route.id&&e.at>command.now)) return state;
    if (command.type === "delivery-failure" && (!Object.hasOwn(ISSUE_REASONS, command.reason) ||
      command.description.trim().length > 500 || (command.reason === "OTHER" && command.description.trim().length < 3))) return state;
  }
  // Expiry wins at the exact deadline, even if the store's decision reaches the reducer first.
  let next = settleIssues(state, command.now);
  if (command.type === "issue-timeout-config") {
    if (!validIssueTimeout(command.minutes) || next.issueTimeoutMinutes === command.minutes) return next;
    next = recordEvent({...next, issueTimeoutMinutes: command.minutes}, {id: `${command.commandId}:config`,
      type: "ISSUE_TIMEOUT_CHANGED", at: command.now, actorId: command.actorId, actorType: "STORE", detail: String(command.minutes)});
  } else if (command.type === "alert-view" || command.type === "alert-dismiss") {
    const ids = [...new Set(command.issueIds)];
    if (!ids.length || ids.length > 1000 || ids.some(id => !next.issues.some(i => i.id === id && command.now >= i.reportedAt))) return next;
    const field = command.type === "alert-view" ? "viewedAt" : "dismissedAt";
    const changed = ids.filter(id => next.alertReceipts[id]?.[field] === undefined);
    if (!changed.length) return next;
    const receipts = {...next.alertReceipts};
    for (const id of changed) {
      receipts[id] = {...receipts[id], [field]: command.now, actorId: command.actorId};
      next = recordEvent(next, {id: `${command.commandId}:${id}`, type: command.type === "alert-view" ? "ALERT_VIEWED" : "ALERT_DISMISSED",
        at: command.now, actorId: command.actorId, actorType: "STORE", issueId: id});
    }
    next = {...next, alertReceipts: receipts};
  } else if (command.type === "issue-decide") {
    const issue = next.issues.find(i => i.id === command.issueId && i.status === "PENDING");
    if (!issue || command.now < issue.reportedAt || !["RETRY", "RETURN", "CANCEL"].includes(command.decision)) return next;
    const closed = closeIssue(next, issue, command.decision, command.actorId, command.now, command.commandId);
    if (closed === next) return next;
    next = progressRoute(closed, issue.routeId, command.now, command.commandId);
  } else if (command.type === "delivery-cancel") {
    const route = next.routes.find(r => r.id === command.routeId && r.status === "ON_ROUTE");
    const order = next.orders.find(o => o.id === command.orderId);
    if (!route || !order || !route.orderIds.includes(order.id) || command.now < order.createdAt || state.events.some(e=>e.routeId===route.id&&e.at>command.now) ||
      (!deliveryEligible(order.delivery) && order.delivery !== "ATTEMPT_FAILED")) return next;
    const issue = next.issues.find(i => i.orderId === order.id && i.routeId === route.id && i.status === "PENDING");
    if (issue) next = closeIssue(next, issue, "CANCEL", command.actorId, command.now, command.commandId);
    else next = {...next, orders: next.orders.map(o => o.id === order.id ? {...o, delivery: "CANCELLED", status: "CANCELLED"} : o)};
    next = recordEvent(next, {id: `${command.commandId}:cancel`, type: "DELIVERY_CANCELLED", at: command.now,
      actorId: command.actorId, actorType: "STORE", routeId: route.id, orderId: order.id});
    next = progressRoute(next, route.id, command.now, command.commandId);
  } else {
    const route = next.routes.find(r => r.id === command.routeId && r.status === "ON_ROUTE");
    const order = route && nextDelivery(next, route);
    if (!route || !order || order.id !== command.orderId || (order.attemptNumber ?? 1) !== command.expectedAttempt) return next;
    if (command.type === "delivery-complete") {
      next = {...next, orders: next.orders.map(o => o.id === order.id ? {...o, delivery: "DELIVERED", status: "DELIVERED"} : o)};
      next = recordEvent(next, {id: `${command.commandId}:delivered`, type: "DELIVERY_COMPLETED", at: command.now,
        actorId: command.actorId, actorType: "COURIER", routeId: route.id, orderId: order.id});
    } else {
      const issueId = `issue:${order.id}:${command.expectedAttempt}`;
      if (next.issues.some(i => i.id === issueId || (i.orderId === order.id && i.status === "PENDING"))) return next;
      next = {...next,
        orders: next.orders.map(o => o.id === order.id ? {...o, delivery: "ATTEMPT_FAILED"} : o),
        issues: [...next.issues, {id: issueId, orderId: order.id, routeId: route.id, courierId: command.actorId,
          attempt: command.expectedAttempt, reason: command.reason, description: command.description.trim(),
          reportedAt: command.now, decisionDeadline: command.now + next.issueTimeoutMinutes * 60_000, status: "PENDING"}],
      };
      next = recordEvent(next, {id: `${command.commandId}:failed`, type: "DELIVERY_ATTEMPT_FAILED", at: command.now,
        actorId: command.actorId, actorType: "COURIER", routeId: route.id, orderId: order.id, issueId, detail: command.reason});
    }
    next = progressRoute(next, route.id, command.now, command.commandId);
  }
  return {...next, commandIds: [...next.commandIds, command.commandId]};
}
