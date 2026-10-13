export const DEMO_STORE_ACTOR = "demo-store-operator";
export const ISSUE_REASONS = {
  CUSTOMER_NOT_FOUND: "Cliente não localizado",
  CUSTOMER_NOT_RESPONDING: "Cliente não responde",
  ADDRESS_PROBLEM: "Problema no endereço",
  OTHER: "Outro motivo",
} as const;
export type IssueReason = keyof typeof ISSUE_REASONS;
export type IssueDecision = "RETRY" | "RETURN" | "CANCEL";
export type IssueResolution = IssueDecision | "TIMEOUT" | "OTHERS_FINISHED";
export type DeliveryStatus = "WAITING" | "ASSIGNED" | "ON_ROUTE" | "NEXT" |
  "ATTEMPT_FAILED" | "RETURN_TO_STORE" | "DELIVERED" | "CANCELLED";
export type DemoIssue = {
  id: string; orderId: string; routeId: string; courierId: string;
  attempt: number; reason: IssueReason; description: string;
  reportedAt: number; decisionDeadline: number;
  status: "PENDING" | "CLOSED";
  closedAt?: number; decidedBy?: string; resolution?: IssueResolution;
};
export type DemoEvent = {
  id: string; type: "DELIVERY_ATTEMPT_FAILED" | "DELIVERY_COMPLETED" |
    "ISSUE_DECIDED" | "ISSUE_AUTO_RETURNED" | "DELIVERY_CANCELLED" |
    "NEXT_DELIVERY_CHANGED" | "ROUTE_STARTED" | "ROUTE_RETURNING" |
    "COURIER_ARRIVED" | "ALERT_VIEWED" | "ALERT_DISMISSED" | "ISSUE_TIMEOUT_CHANGED";
  at: number; actorId: string; actorType: "COURIER" | "STORE" | "SYSTEM";
  routeId?: string; orderId?: string; issueId?: string;
  detail?: string;
};
export type AlertReceipt = { viewedAt?: number; dismissedAt?: number; actorId: string };
type DeliveryAction = {routeId: string; orderId: string; actorId: string; now: number; commandId: string; expectedAttempt: number};
type ReceiptAction = {issueIds: string[]; actorId: string; now: number; commandId: string};
export type IssueCommand =
  | ({type: "delivery-complete"} & DeliveryAction)
  | ({type: "delivery-failure"; reason: IssueReason; description: string} & DeliveryAction)
  | {type: "issue-decide"; issueId: string; decision: IssueDecision; actorId: string; now: number; commandId: string}
  | {type: "delivery-cancel"; routeId: string; orderId: string; actorId: string; now: number; commandId: string}
  | {type: "issue-timeout-config"; minutes: number; actorId: string; now: number; commandId: string}
  | ({type: "alert-view"} & ReceiptAction)
  | ({type: "alert-dismiss"} & ReceiptAction)
  | {type: "issues-tick"; now: number};
export const deliveryFinal = (status: DeliveryStatus) =>
  status === "DELIVERED" || status === "CANCELLED" || status === "RETURN_TO_STORE";
export const deliveryEligible = (status: DeliveryStatus) => status === "ON_ROUTE" || status === "NEXT";
export const validIssueTime = (at: number) => Number.isSafeInteger(at) && at > 0 && at < 8e15;
export const validIssueTimeout = (minutes: number) => Number.isInteger(minutes) && minutes >= 1 && minutes <= 60;
