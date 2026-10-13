import type { DemoState } from "./model.ts";
import type { DemoIssue, IssueResolution } from "./issue-types.ts";

export const RESOLUTIONS: Record<IssueResolution, string> = {
  RETRY: "Nova tentativa liberada", RETURN: "Retornar pedido à loja", CANCEL: "Entrega cancelada",
  TIMEOUT: "Prazo de resposta encerrado", OTHERS_FINISHED: "Demais entregas encerradas · retorno automático",
};
export function pendingIssues(state: DemoState) {
  return state.issues.filter(i => i.status === "PENDING").sort((a,b) =>
    a.decisionDeadline-b.decisionDeadline || a.reportedAt-b.reportedAt || (a.id<b.id?-1:a.id>b.id?1:0));
}
export function issueTiming(issue: DemoIssue, now: number) {
  const elapsed = Math.max(0, Math.floor(((issue.closedAt ?? now) - issue.reportedAt)/60_000));
  // Shared UI clock can lag the click by <1s; never show 11min for a new 10min window.
  const remaining = Math.min(Math.ceil((issue.decisionDeadline-issue.reportedAt)/60_000),Math.max(0, Math.ceil((issue.decisionDeadline-now)/60_000)));
  return {
    elapsed: elapsed ? `${elapsed} min aguardando` : "Registrada agora",
    remaining: remaining ? `Decidir em ${remaining} min` : "Prazo de resposta encerrado",
    tone: issue.status === "CLOSED" ? issue.resolution === "TIMEOUT" ? "red" : issue.resolution === "RETRY" ? "green" : "neutral"
      : issue.decisionDeadline-now <= 120_000 ? "red" : "orange",
  };
}
export const deliveryLabels = {
  WAITING: "Aguardando despacho", ASSIGNED: "Atribuída", ON_ROUTE: "Em rota", NEXT: "Próxima entrega",
  ATTEMPT_FAILED: "Aguardando decisão da loja", RETURN_TO_STORE: "Retornar pedido à loja", DELIVERED: "Entregue", CANCELLED: "Cancelada",
} as const;
