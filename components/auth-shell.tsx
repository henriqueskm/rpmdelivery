import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <aside className="brand-panel">
        <Brand light />
        <div className="brand-story">
          <span className="eyebrow light">MAIS RITMO. MENOS DISTÂNCIA.</span>
          <h2>
            Sua operação.
            <br />
            Em outro <em>ritmo.</em>
          </h2>
          <p>
            Um lugar para conectar seu restaurante
            <br className="desktop-break" /> ao próximo destino.
          </p>
          <div className="route-art" aria-hidden="true">
            <div className="route-grid" />
            <svg className="route-line" viewBox="0 0 440 200" fill="none">
              <path
                d="M40 140H135Q160 140 160 115V80Q160 55 185 55H290Q315 55 315 80V140H400"
                stroke="#fb673b"
                strokeWidth="3"
                strokeDasharray="7 8"
              />
              <circle cx="40" cy="140" r="8" fill="#fb673b" />
              <circle cx="400" cy="140" r="8" fill="#fb673b" />
            </svg>
            <span className="route-label route-origin">
              01 <strong>Seu restaurante</strong>
            </span>
            <span className="route-label route-destination">
              02 <strong>Próximo destino</strong>
            </span>
            <span className="route-pin">↗</span>
          </div>
        </div>
        <div className="brand-footer">
          <span className="status-dot" /> Feito para quem não para.
        </div>
      </aside>
      <section className="auth-content">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="form-card">{children}</div>
        <footer className="auth-footer">
          RpmDelivery <span>•</span> Sua operação em movimento.
        </footer>
      </section>
    </main>
  );
}
