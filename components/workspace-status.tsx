import { Brand } from "@/components/brand";

export function WorkspaceStatus({
  message,
  retry,
}: {
  message?: string;
  retry: () => void;
}) {
  return (
    <main className="workspace-status">
      <Brand />
      <div>
        <span className="eyebrow">RpmDelivery</span>
        <h1>{message ? "Vamos tentar de novo?" : "Preparando seu espaço…"}</h1>
        {message ? (
          <>
            <p className="notice error" role="alert">
              {message}
            </p>
            <button className="button primary" onClick={retry}>
              Tentar novamente
            </button>
          </>
        ) : (
          <p role="status">
            <span className="spinner dark" aria-hidden="true" /> Verificando seu
            acesso e restaurante.
          </p>
        )}
      </div>
    </main>
  );
}
