"use client";

import { Brand } from "@/components/brand";
import { WorkspaceStatus } from "@/components/workspace-status";
import { useWorkspace } from "@/hooks/use-workspace";
import { SignOut } from "@/features/auth/sign-out";

export function Dashboard() {
  const { state, retry } = useWorkspace("dashboard");
  if (state.status !== "ready" || !state.restaurant)
    return (
      <WorkspaceStatus
        message={state.status === "error" ? state.message : undefined}
        retry={retry}
      />
    );
  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <Brand />
        <div className="account">
          <span className="avatar" aria-hidden="true">
            {state.restaurant.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{state.restaurant.name}</strong>
            <small>{state.user.email}</small>
          </div>
          <SignOut />
        </div>
      </header>
      <div className="dashboard-body">
        <nav className="dashboard-nav" aria-label="Área atual">
          <span className="nav-current">
            ◈ <span>Visão geral</span>
          </span>
          <span className="workspace-tag">SEU ESPAÇO DE OPERAÇÃO</span>
        </nav>
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow">PRONTO PARA O PRÓXIMO DESTINO</span>
            <h1>
              Um novo ritmo
              <br className="mobile-only" /> começa aqui.
            </h1>
            <p>Bem-vindo ao RpmDelivery, {state.restaurant.name}.</p>
          </div>
          <span className="setup-badge">
            <span className="status-dot" />
            Restaurante configurado
          </span>
        </div>
        <section className="welcome-banner">
          <div>
            <span className="eyebrow">PRIMEIRO PASSO CONCLUÍDO</span>
            <h2>Seu restaurante já tem um lugar.</h2>
            <p>{state.restaurant.address}</p>
          </div>
          <span className="banner-arrow" aria-hidden="true">
            ↗
          </span>
        </section>
        <section className="empty-operation" aria-labelledby="empty-title">
          <div className="empty-art" aria-hidden="true">
            <span className="empty-orbit" />
            <svg viewBox="0 0 80 80">
              <path
                d="M21 28 40 18l19 10v26L40 64 21 54V28Z"
                fill="#fff"
                stroke="#24342d"
                strokeWidth="2"
              />
              <path
                d="m21 28 19 11 19-11M40 39v25M30 23l19 11v10"
                stroke="#24342d"
                strokeWidth="2"
                fill="none"
              />
              <circle cx="62" cy="59" r="12" fill="#c34820" />
              <path
                d="m57 59 4 4 7-8"
                stroke="white"
                strokeWidth="2"
                fill="none"
              />
            </svg>
          </div>
          <span className="eyebrow">TUDO COMEÇA COM O PRIMEIRO PEDIDO</span>
          <h2 id="empty-title">
            A próxima entrega
            <br />é um novo começo.
          </h2>
          <p>
            Seu espaço está pronto. O gerenciamento de pedidos
            <br className="desktop-break" /> e entregadores chega nas próximas
            etapas.
          </p>
          <span className="coming-next">
            Em breve <span aria-hidden="true">→</span> Pedidos e entregas
          </span>
        </section>
        <footer className="dashboard-footer">
          <span>RpmDelivery • Operação em movimento.</span>
          <span>Um passo de cada vez. Sempre em frente.</span>
        </footer>
      </div>
    </main>
  );
}
