import { plural } from "./model";

export function AlertsToolbar({count,onOpen,onFollow,toRelease=0,enabled,activating,onSound,message}:{
  count: number; onOpen: () => void; onFollow: () => void;
  /** Routes waiting for the store to release their pickup. */
  toRelease?: number;
  enabled: boolean; activating: boolean; onSound: () => void; message: string;
}) {
  return <div className="ops-alert-toolbar" aria-label="Alertas da operação">
    <button className="ops-alert-count" data-pending={count>0} onClick={onOpen}
      aria-label={`Ocorrências: ${count ? plural(count,"pendência","pendências") : "sem pendências"}`}>
      <span aria-hidden="true">!</span> {count ? plural(count,"pendência","pendências") : "Sem pendências"}
    </button>
    <button className="ops-follow-routes" data-release={toRelease>0} onClick={onFollow}
      aria-label={toRelease ? `Acompanhar rotas · ${plural(toRelease,"rota para liberar","rotas para liberar")}` : undefined}>
      Acompanhar rotas{toRelease>0&&<span className="ops-tab-count" aria-hidden="true">{toRelease}</span>}
    </button>
    <button className="ops-alert-sound" aria-pressed={enabled} disabled={activating}
      aria-label={enabled ? "Silenciar alertas" : "Ativar som de alertas"} onClick={onSound}>
      <span aria-hidden="true">{enabled ? "♪" : "♩"}</span> {activating ? "Ativando…" : enabled ? "Silenciar som" : "Ativar som"}
    </button>
    {message && <small role="status">{message}</small>}
  </div>;
}
