import type { DemoIssue } from "./issue-types";
import { ISSUE_REASONS } from "./issue-types";
import { plural, type DemoState } from "./model";
import { issueTiming } from "./issue-presentation";

export function NewIssueBanner({issues,state,now,onDismiss,onOpen,onFollow}:{
  issues: DemoIssue[]; state: DemoState; now: number;
  onDismiss: (ids: string[]) => void; onOpen: () => void; onFollow: (id: string) => void;
}) {
  if (!issues.length) return null;
  const issue = issues[0], order = state.orders.find(o => o.id === issue.orderId)!,
    route = state.routes.find(r => r.id === issue.routeId)!, courier = state.couriers.find(c => c.id === issue.courierId)!;
  const timing = issueTiming(issue,now);
  return <aside className="ops-new-issue" data-tone={timing.tone} aria-labelledby="ops-new-issue-title">
    <div className="ops-new-issue-top"><span className="ops-new-issue-icon" aria-hidden="true">!</span>
      <div><h2 id="ops-new-issue-title">{issues.length === 1 ? "Nova ocorrência de entrega" : `${plural(issues.length,"nova ocorrência","novas ocorrências")}`}</h2>
        <p role="alert" aria-atomic="true">#{order.reference} · {route.reference} · {courier.name}: {ISSUE_REASONS[issue.reason]}.</p>
      </div><button aria-label="Fechar aviso sem resolver ocorrências" onClick={() => onDismiss(issues.map(i => i.id))}>×</button>
    </div>
    {issue.reason === "OTHER" && <p className="ops-alert-description">{Array.from(issue.description).slice(0,160).join("")}{issue.description.length>160?"…":""}</p>}
    <div className="ops-new-issue-bottom"><p aria-live="off"><strong>{timing.remaining}</strong> · {timing.elapsed}</p>
      <div><button className="ops-primary" onClick={onOpen}>Decidir na Central</button><button onClick={() => {onDismiss(issues.map(i=>i.id));onFollow(route.id);}}>Acompanhar rotas</button></div>
    </div>
    <small>Fechar este aviso mantém as pendências. A loja precisa decidir.</small>
  </aside>;
}
