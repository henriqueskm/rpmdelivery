import type { DemoState } from "./model.ts";
import type { DemoEvent, DemoIssue, IssueResolution } from "./issue-types.ts";

export function recordEvent(state: DemoState, event: DemoEvent): DemoState {
  return state.events.some(e => e.id === event.id) ? state : {...state, events: [...state.events, event]};
}
export function closeIssue(state: DemoState, issue: DemoIssue, resolution: IssueResolution,
  actorId: string, now: number, cause: string): DemoState {
  if (issue.status !== "PENDING" || !state.orders.some(o => o.id === issue.orderId && o.delivery === "ATTEMPT_FAILED") ||
    !state.routes.some(r => r.id === issue.routeId && r.status === "ON_ROUTE" && r.courierId === issue.courierId && r.orderIds.includes(issue.orderId))) return state;
  const automatic = resolution === "TIMEOUT" || resolution === "OTHERS_FINISHED";
  const next: DemoState = {
    ...state,
    issues: state.issues.map(i => i.id === issue.id ? {...i, status: "CLOSED", resolution, closedAt: now, decidedBy: actorId} : i),
    orders: state.orders.map(o => o.id !== issue.orderId ? o : resolution === "RETRY"
      ? {...o, delivery: "ON_ROUTE", attemptNumber: (o.attemptNumber ?? 1) + 1}
      : resolution === "CANCEL" ? {...o, delivery: "CANCELLED", status: "CANCELLED"}
        : {...o, delivery: "RETURN_TO_STORE"}),
    routes: resolution === "RETRY" ? state.routes.map(r => r.id === issue.routeId
      ? {...r, retryOrderIds: [...(r.retryOrderIds ?? []).filter(id => id !== issue.orderId), issue.orderId]} : r) : state.routes,
  };
  return recordEvent(next, {
    id: `${cause}:close:${issue.id}`, type: automatic ? "ISSUE_AUTO_RETURNED" : "ISSUE_DECIDED",
    at: now, actorId, actorType: automatic ? "SYSTEM" : "STORE", routeId: issue.routeId,
    orderId: issue.orderId, issueId: issue.id, detail: resolution,
  });
}
