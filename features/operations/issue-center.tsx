import { useRef, useState, type RefObject } from "react";
import type { Command, DemoState } from "./model";
import { DEMO_STORE_ACTOR } from "./issue-types";
import { pendingIssues } from "./issue-presentation";
import { IssueCard } from "./issue-card";

export function IssueCenter({dialogRef,state,now,onCommand,onFollow}:{
  dialogRef: RefObject<HTMLDialogElement | null>; state: DemoState; now: number;
  onCommand: (command: Command) => boolean; onFollow: (id: string) => void;
}) {
  const [view,setView] = useState<"pending"|"history">("pending"), [page,setPage] = useState(0);
  const [error,setError] = useState("");
  const pendingRef = useRef<HTMLButtonElement>(null),historyRef = useRef<HTMLButtonElement>(null);
  const pending = pendingIssues(state),closed = state.issues.filter(i => i.status === "CLOSED").sort((a,b) => b.closedAt!-a.closedAt!);
  const issues = view === "pending" ? pending : closed;
  const last = Math.max(0,Math.ceil(issues.length/20)-1), current = Math.min(page,last);
  function switchView(next: "pending"|"history") {setView(next);setPage(0);}
  return <dialog ref={dialogRef} className="ops-dialog ops-issue-center" aria-labelledby="ops-issue-center-title">
    <div className="ops-dialog-heading"><h2 id="ops-issue-center-title">Central de ocorrências</h2><button aria-label="Fechar Central de ocorrências" onClick={() => dialogRef.current?.close()}>×</button></div>
    <p className="ops-dialog-notice">Demonstração em memória. Decisões atualizam apenas os dados fictícios desta página.</p>
    <div role="tablist" aria-label="Ocorrências">
      <button ref={pendingRef} role="tab" aria-selected={view==="pending"} tabIndex={view==="pending"?0:-1} aria-controls="ops-issues-list"
        onClick={() => switchView("pending")} onKeyDown={e => {if(["ArrowLeft","ArrowRight","End"].includes(e.key)){e.preventDefault();switchView("history");historyRef.current?.focus();}}}>Pendentes ({pending.length})</button>
      <button ref={historyRef} role="tab" aria-selected={view==="history"} tabIndex={view==="history"?0:-1} aria-controls="ops-issues-list"
        onClick={() => switchView("history")} onKeyDown={e => {if(["ArrowLeft","ArrowRight","Home"].includes(e.key)){e.preventDefault();switchView("pending");pendingRef.current?.focus();}}}>Histórico ({closed.length})</button>
    </div>
    <div className="ops-issue-center-body" id="ops-issues-list" role="tabpanel" aria-label={view==="pending"?"Ocorrências pendentes":"Histórico de ocorrências"} tabIndex={0}>
      {!issues.length&&<p className="ops-issue-empty" role="status">{view==="pending"?"Nenhuma ocorrência pendente. A operação pode seguir.":"Nenhuma ocorrência encerrada nesta demonstração."}</p>}
      {issues.slice(current*20,(current+1)*20).map(issue => <IssueCard key={issue.id} issue={issue} state={state} now={now} onCommand={command=>{
        const result=onCommand(command);window.requestAnimationFrame(()=>{
          if(dialogRef.current?.open&&!dialogRef.current.contains(document.activeElement))pendingRef.current?.focus();
        });return result;
      }}
        onFollow={id => {dialogRef.current?.close();onFollow(id);}}/>)}
    </div>
    {issues.length>20&&<div className="ops-auto-pagination"><button aria-label="Ocorrências anteriores" disabled={current===0} onClick={() => setPage(current-1)}>←</button><span>{current+1}/{last+1} · 20 por página</span><button aria-label="Próximas ocorrências" disabled={current===last} onClick={() => setPage(current+1)}>→</button></div>}
    <details className="ops-issue-settings"><summary>Tempo de resposta da loja · {state.issueTimeoutMinutes} min</summary>
      <form onSubmit={e => {
        e.preventDefault();const data = new FormData(e.currentTarget);setError("");
        const minutes = Number(data.get("minutes"));
        if(!Number.isInteger(minutes)||minutes<1||minutes>60){setError("Escolha entre 1 e 60 minutos.");return;}
        if(minutes!==state.issueTimeoutMinutes)onCommand({type:"issue-timeout-config",minutes,actorId:DEMO_STORE_ACTOR,now:Date.now(),commandId:`timeout-config:${state.events.length}:${minutes}`});
      }}><label>Minutos para decidir<input key={state.issueTimeoutMinutes} name="minutes" type="number" min={1} max={60} required defaultValue={state.issueTimeoutMinutes}/></label><button>Salvar prazo demonstrativo</button></form>
      <p>Vale para novas ocorrências. As atuais mantêm o limite definido no registro da falha.</p>{error&&<p role="alert">{error}</p>}
    </details>
  </dialog>;
}
