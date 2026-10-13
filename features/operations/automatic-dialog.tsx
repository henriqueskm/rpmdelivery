import { useEffect, useMemo, useRef, useState } from "react";
import type { PlannedGroup, PlanningParameters } from "../route-planning/types";
import { automaticInput } from "./automatic-input";
import { automaticSnapshot, type AssignmentProposal } from "./automatic-assignment";
import { useAutomaticProposal } from "./use-automatic-proposal";
import type { DemoState } from "./model";
import { calendarTime, localDateTime, parseLocalDateTime, deadlineAt } from "./deadlines";
import { AutomaticRoutes } from "./automatic-routes";
import "./optimization.css";
import "./automatic.css";
export function AutomaticDialog({state,scenario,now,onClose,onAccept}:{
  state:DemoState;scenario:string;now:number;onClose:(accepted:boolean)=>void;
  onAccept:(proposal:AssignmentProposal,groups:PlannedGroup[],parameters:PlanningParameters)=>boolean;
}) {
  const dialog=useRef<HTMLDialogElement>(null), [departure,setDeparture]=useState(()=>localDateTime(now+300000));
  const accepted=useRef(false);
  const [capacity,setCapacity]=useState("4"),[service,setService]=useState("2"),[duration,setDuration]=useState("60");
  const [editing,setEditing]=useState(false),[selected,setSelected]=useState<string[]>([]);
  const snapshot=useMemo(()=>automaticSnapshot(state),[state]);
  const parameters=useMemo<PlanningParameters>(()=>({departureAt:parseLocalDateTime(departure),serviceSeconds:service.trim()?Number(service)*60:NaN,
    capacity:capacity.trim()?Number(capacity):NaN,maxRouteSeconds:duration.trim()?Number(duration)*60:NaN}),[departure,service,capacity,duration]);
  const expired=parameters.departureAt<now;
  const key=useMemo(()=>JSON.stringify([snapshot,scenario,parameters,expired]),[snapshot,scenario,parameters,expired]);
  const {job,calculate,cancel}=useAutomaticProposal(key);
  const stale=!!job&&(job.key!==key||parameters.departureAt<now),pending=!stale&&job?.status==="pending";
  const plan=!stale?job?.result:undefined, ready=!!plan&&job?.status==="done";
  const selectedIds=new Set(plan?.routes.filter(r=>selected.includes(r.courierId)).flatMap(r=>r.ids)??[]);
  const stillWaiting=state.orders.filter(o=>o.delivery==="WAITING"&&!selectedIds.has(o.id));
  const waitingOverdue=stillWaiting.filter(o=>deadlineAt(o)<=parameters.departureAt).length;
  useEffect(()=>{dialog.current?.showModal();dialog.current?.querySelector<HTMLInputElement>("input")?.focus();},[]);
  function request(groups?:PlannedGroup[]) {
    setEditing(false);calculate(key,()=>automaticInput(state,scenario,parameters),groups);
    if(!groups)setSelected([]);
  }
  function accept(ids:string[]) {
    if(!ready||!plan)return;
    const groups=plan.routes.filter(r=>ids.includes(r.courierId)).map(r=>({courierId:r.courierId,ids:r.ids}));
    if(onAccept({snapshot,plan},groups,parameters)) {accepted.current=true;dialog.current?.close();}
  }
  return <dialog ref={dialog} className="ops-dialog ops-optimization-dialog ops-automatic-dialog" aria-label="Montagem automática" onClose={()=>onClose(accepted.current)}>
    <div className="ops-dialog-heading"><h2>Montagem automática</h2><button aria-label="Fechar montagem automática" onClick={()=>dialog.current?.close()}>×</button></div>
    <p className="ops-dialog-notice">Demonstração · pedidos, coordenadas e matriz fictícios. Sem Mapbox real, persistência ou garantia de chegada.</p>
    {plan&&!editing?<div className="ops-opt-hypotheses-summary"><span>Saída {calendarTime(parameters.departureAt)} · até {capacity}/rota · {service} min/parada · máx. {duration} min/rota</span><button onClick={()=>setEditing(true)}>Editar critérios</button></div>:
      <div className="ops-auto-controls">
        <label>Saída estimada<input type="datetime-local" value={departure} onChange={e=>setDeparture(e.target.value)}/></label>
        <label>Entregas por rota<select aria-label="Entregas por rota" value={capacity} onChange={e=>setCapacity(e.target.value)}>{[1,2,3,4,5,6,7,8].map(n=><option key={n}>{n}</option>)}</select></label>
        <label>Atendimento por parada (min)<input type="number" min={0} max={30} step={1} value={service} onChange={e=>setService(e.target.value)}/></label>
        <details><summary>Limite de duração</summary><label>Duração máxima da rota (min)<input type="number" min={1} max={120} value={duration} onChange={e=>setDuration(e.target.value)}/></label><small>Inclui atendimento e retorno. Limite demonstrativo.</small></details>
        <button disabled={pending||expired} onClick={()=>request()}>Gerar propostas (demo)</button>
      </div>}
    <div className="ops-opt-scroll" tabIndex={0} aria-label="Propostas de montagem automática">
      {!job&&<p>Usa pedidos aguardando, até 24 por lote, priorizando prazos. Capacidade padrão 4; nada muda antes de confirmar. Motoboys reservados, em rota ou retornando ficam fora.</p>}
      {pending&&<p role="status">Calculando propostas… <button onClick={cancel}>Cancelar cálculo</button></p>}
      {(stale||expired)&&<p role="alert">{expired?"A saída estimada ficou no passado. Atualize o horário e recalcule; nenhuma rota foi atribuída.":
        "Dados ou critérios mudaram. Nenhuma rota foi atribuída; recalcule as propostas."}</p>}
      {!stale&&job?.error==="adjustment"&&<p role="alert">Esse ajuste não é viável com os critérios atuais. A proposta anterior foi preservada; nenhuma rota foi atribuída.</p>}
      {!stale&&job?.status==="error"&&<p role="alert">{job.error==="budget"?"O cálculo atingiu o limite de 5 segundos. Nenhuma rota foi criada.":
        "Não foi possível gerar propostas com esses dados ou critérios. Confira coordenadas, horários e limites; a montagem manual continua disponível."}</p>}
      {plan&&<AutomaticRoutes plan={plan} state={state} now={now} selected={selected} onSelect={setSelected} onEdit={request} onAccept={accept} disabled={!ready}/>}
    </div>
    <p className="ops-auto-context">Rotas ficam em preparação; loja libera retirada e só o motoboy inicia.
      {selected.length>0?<> {stillWaiting.length} pedidos ficam aguardando; <strong>{waitingOverdue} com prazo vencido na saída.</strong></>:
        <> Selecione rotas ou confirme uma individualmente. As demais continuam aguardando.</>}</p>
    <div className="ops-opt-footer"><button onClick={()=>dialog.current?.close()}>Voltar sem atribuir</button>
      <button className="ops-primary" disabled={!ready||!selected.some(id=>plan?.routes.some(r=>r.courierId===id))} onClick={()=>accept(selected)}>
        Confirmar {selected.filter(id=>plan?.routes.some(r=>r.courierId===id)).length} rotas (demo)</button></div>
  </dialog>;
}
