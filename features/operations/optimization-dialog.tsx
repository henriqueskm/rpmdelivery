import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoState } from "./model";
import { localDateTime, parseLocalDateTime } from "./deadlines";
import { demoOptimizationInput, proposalSignature } from "./optimization-input";
import { useRouteProposal } from "./use-route-proposal";
import { SequenceComparison } from "./sequence-comparison";
import { MAX_STOPS } from "../route-optimization/types";
import "./optimization.css";

const messages: Record<string,string> = {
  limit: `Selecione até ${MAX_STOPS} pedidos. A seleção não foi reduzida; mantenha a montagem manual ou escolha uma saída menor.`,
  coordinates: "Faltam coordenadas confirmadas. A montagem manual continua disponível; o cadastro demonstrativo não geocodifica endereços.",
  phase: "Somente uma montagem nova ou rota em preparação pode receber sugestões.",
  matrix: "Os dados de trajeto não são válidos. Continue pela montagem manual.",
  "no-route": "Não existe percurso completo com retorno à loja nesta matriz. Confira os destinos; não foi removido nenhum pedido.",
  invalid: "Confira os pedidos, o horário de saída e o atendimento por parada (0–30 minutos inteiros).",
  unavailable: "Simulação de serviço indisponível. Nenhuma sequência foi alterada; continue pela montagem manual.",
};
export function OptimizationDialog({ state, selected, editingId, scenario, now, onApply, onClose }: {
  state:DemoState; selected:string[]; editingId?:string; scenario:string; now:number;
  onApply:(ids:string[])=>void; onClose:()=>void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [departure, setDeparture] = useState(() => localDateTime(now + 5*60000));
  const [service, setService] = useState("2");
  const {job,calculate} = useRouteProposal();
  const snapshot = useMemo(() => proposalSignature(state,selected,editingId),[state,selected,editingId]);
  const key = JSON.stringify([snapshot,scenario,departure,service]);
  const departureAt = parseLocalDateTime(departure);
  const serviceSeconds = service.trim() && Number.isInteger(Number(service)) ? Number(service)*60 : NaN;
  const stale = !!job && (job.key !== key || departureAt < now);
  const result = !stale && job?.status === "done" ? job.result : undefined;
  const pending = !stale && job?.status === "pending";
  const unchanged = !!result && JSON.stringify(result.suggested.ids) === JSON.stringify(selected);
  const blocked = !!editingId && state.routes.find(r => r.id === editingId)?.status !== "PREPARING";
  useEffect(() => { dialog.current?.showModal(); dialog.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);
  function request() {
    calculate(key, () => demoOptimizationInput(state,selected,editingId,scenario,departureAt,serviceSeconds));
  }
  return <dialog ref={dialog} className="ops-dialog ops-optimization-dialog" aria-label="Sugerir sequência" onClose={onClose}>
    <div className="ops-dialog-heading"><h2>Sugerir sequência</h2><button aria-label="Fechar sugestão" onClick={()=>dialog.current?.close()}>×</button></div>
    <p className="ops-dialog-notice">Demonstração · matriz e coordenadas simuladas. Sem Mapbox real, trânsito ou garantia de prazo.</p>
    <div className="ops-opt-controls">
      <label>Saída estimada<input type="datetime-local" value={departure} onChange={e=>setDeparture(e.target.value)} /></label>
      <label>Atendimento por parada (min)<input type="number" inputMode="numeric" min={0} max={30} step={1} value={service} onChange={e=>setService(e.target.value)} /></label>
      <button disabled={pending || blocked || selected.length>MAX_STOPS} onClick={request}>Calcular sugestão (demo)</button>
    </div>
    <div className="ops-opt-scroll" tabIndex={0} aria-label="Comparação das sequências">
      {!job && <p>Até {MAX_STOPS} paradas. Primeiro menos entregas atrasadas; depois menor atraso total, deslocamento e retorno. Nada muda sem aplicar.</p>}
      {selected.length>MAX_STOPS && <p role="alert">{messages.limit}</p>}
      {pending && <p role="status">Calculando com a matriz simulada…</p>}
      {stale && <p role="status">Dados ou saída estimada mudaram. Recalcule a sugestão antes de aplicar.</p>}
      {!stale && job?.status==="error" && <p role="alert">{messages[job.error!]??messages.invalid}</p>}
      {result && <>
        <p className="ops-opt-verdict" role="status">{!result.allDeadlinesPossible
          ? "Nenhuma sequência cumpre todos os prazos sob estas hipóteses. Há risco de atraso."
          : "Sem atraso previsto na sugestão sob estas hipóteses; a saída e o trânsito podem mudar."}
          {unchanged && " A ordem manual já é a melhor neste cenário."}</p>
        <div className="ops-opt-columns"><SequenceComparison title="Ordem manual" route={result.manual} state={state} departureAt={result.departureAt} />
          <SequenceComparison title="Ordem sugerida" route={result.suggested} state={state} departureAt={result.departureAt} /></div>
      </>}
    </div>
    <div className="ops-opt-footer">
      <button onClick={()=>dialog.current?.close()}>Descartar</button>
      <button className="ops-primary" disabled={!result||unchanged||blocked||stale} onClick={()=>{
        if(result&&!blocked&&!stale){onApply(result.suggested.ids);dialog.current?.close();}
      }}>Aplicar sequência (demo)</button>
    </div>
  </dialog>;
}
