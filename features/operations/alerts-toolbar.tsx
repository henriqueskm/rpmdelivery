import { plural } from "./model";

export function AlertsToolbar({count,onOpen,onFollow,enabled,activating,onSound,message}:{
  count: number; onOpen: () => void; onFollow: () => void;
  enabled: boolean; activating: boolean; onSound: () => void; message: string;
}) {
  return <div className="ops-alert-toolbar" aria-label="Alertas da operação">
    <button className="ops-alert-count" data-pending={count>0} onClick={onOpen}
      aria-label={`Ocorrências: ${count ? plural(count,"pendência","pendências") : "sem pendências"}`}>
      <span aria-hidden="true">!</span> {count ? plural(count,"pendência","pendências") : "Sem pendências"}
    </button>
    <button onClick={onFollow}>Acompanhar rotas</button>
    <button className="ops-alert-sound" aria-pressed={enabled} disabled={activating}
      aria-label={enabled ? "Silenciar alertas" : "Ativar som de alertas"} onClick={onSound}>
      <span aria-hidden="true">{enabled ? "♪" : "♩"}</span> {activating ? "Ativando…" : enabled ? "Silenciar som" : "Ativar som"}
    </button>
    {message && <small role="status">{message}</small>}
  </div>;
}
