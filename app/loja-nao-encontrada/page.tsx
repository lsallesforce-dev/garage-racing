// app/loja-nao-encontrada/page.tsx
//
// Página de erro personalizada para lojas não encontradas no multi-tenant.
// Renderizada quando o middleware não encontra o slug no Redis.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Loja não encontrada | Garage Racing",
  description: "O endereço de loja que você acessou não existe ou foi desativado.",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ slug?: string }>;
}

export default async function LojaNaoEncontradaPage({ searchParams }: PageProps) {
  const { slug } = await searchParams;

  return (
    <main className="lnf-root">
      {/* Background animado */}
      <div className="lnf-bg" aria-hidden="true">
        <div className="lnf-bg__orb lnf-bg__orb--1" />
        <div className="lnf-bg__orb lnf-bg__orb--2" />
        <div className="lnf-bg__orb lnf-bg__orb--3" />
        <div className="lnf-bg__grid" />
      </div>

      <div className="lnf-card">
        {/* Ícone */}
        <div className="lnf-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2Z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M12 8v4M12 16h.01"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Código de erro */}
        <span className="lnf-code">404</span>

        {/* Título */}
        <h1 className="lnf-title">Loja não encontrada</h1>

        {/* Mensagem dinâmica */}
        <p className="lnf-desc">
          {slug ? (
            <>
              A loja{" "}
              <code className="lnf-slug">{slug}</code>{" "}
              não está cadastrada ou foi desativada.
            </>
          ) : (
            "O endereço de loja que você acessou não existe ou foi desativado."
          )}
        </p>

        <p className="lnf-hint">
          Verifique se o link está correto ou entre em contato com a garagem responsável.
        </p>

        {/* CTA */}
        <Link href="/" className="lnf-btn">
          <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path
              fillRule="evenodd"
              d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
              clipRule="evenodd"
            />
          </svg>
          Voltar ao início
        </Link>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        .lnf-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0a0a0f;
          font-family: 'Inter', sans-serif;
          position: relative;
          overflow: hidden;
          padding: 2rem;
        }

        /* ── Background animado ── */
        .lnf-bg {
          position: absolute;
          inset: 0;
          overflow: hidden;
          z-index: 0;
        }
        .lnf-bg__orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.25;
          animation: orb-float 8s ease-in-out infinite;
        }
        .lnf-bg__orb--1 {
          width: 500px; height: 500px;
          background: radial-gradient(circle, #e63946 0%, transparent 70%);
          top: -120px; left: -80px;
          animation-delay: 0s;
        }
        .lnf-bg__orb--2 {
          width: 400px; height: 400px;
          background: radial-gradient(circle, #ff6b35 0%, transparent 70%);
          bottom: -100px; right: -60px;
          animation-delay: -3s;
        }
        .lnf-bg__orb--3 {
          width: 300px; height: 300px;
          background: radial-gradient(circle, #7b2d8b 0%, transparent 70%);
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          animation-delay: -6s;
        }
        .lnf-bg__grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 50px 50px;
        }

        @keyframes orb-float {
          0%, 100% { transform: translateY(0) scale(1); }
          50%       { transform: translateY(-30px) scale(1.05); }
        }

        /* ── Card ── */
        .lnf-card {
          position: relative;
          z-index: 1;
          background: rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          padding: 3rem 2.5rem;
          max-width: 480px;
          width: 100%;
          text-align: center;
          box-shadow:
            0 24px 64px rgba(0,0,0,0.5),
            0 0 0 1px rgba(230, 57, 70, 0.1) inset;
          animation: card-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        @keyframes card-in {
          from { opacity: 0; transform: translateY(24px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* ── Ícone ── */
        .lnf-icon {
          width: 64px; height: 64px;
          margin: 0 auto 1rem;
          background: linear-gradient(135deg, rgba(230,57,70,0.2), rgba(255,107,53,0.2));
          border: 1px solid rgba(230,57,70,0.3);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #e63946;
          animation: pulse-icon 2s ease-in-out infinite;
        }
        .lnf-icon svg { width: 32px; height: 32px; }

        @keyframes pulse-icon {
          0%, 100% { box-shadow: 0 0 0 0 rgba(230,57,70,0.3); }
          50%       { box-shadow: 0 0 0 12px rgba(230,57,70,0); }
        }

        /* ── Código 404 ── */
        .lnf-code {
          display: block;
          font-size: 5rem;
          font-weight: 800;
          line-height: 1;
          background: linear-gradient(135deg, #e63946, #ff6b35);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 0.5rem;
          letter-spacing: -0.04em;
        }

        /* ── Título ── */
        .lnf-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: #f0f0f0;
          margin: 0 0 1rem;
        }

        /* ── Descrição ── */
        .lnf-desc {
          font-size: 0.95rem;
          color: rgba(255,255,255,0.6);
          line-height: 1.6;
          margin-bottom: 0.5rem;
        }
        .lnf-slug {
          background: rgba(230,57,70,0.15);
          border: 1px solid rgba(230,57,70,0.25);
          color: #ff8f96;
          padding: 0.1em 0.5em;
          border-radius: 6px;
          font-size: 0.9em;
          font-family: 'SF Mono', 'Fira Code', monospace;
        }

        /* ── Hint ── */
        .lnf-hint {
          font-size: 0.85rem;
          color: rgba(255,255,255,0.35);
          line-height: 1.5;
          margin-bottom: 2rem;
        }

        /* ── Botão ── */
        .lnf-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: linear-gradient(135deg, #e63946, #c1121f);
          color: #fff;
          text-decoration: none;
          padding: 0.75rem 1.75rem;
          border-radius: 50px;
          font-size: 0.9rem;
          font-weight: 600;
          transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
          box-shadow: 0 4px 24px rgba(230,57,70,0.35);
        }
        .lnf-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(230,57,70,0.5);
          opacity: 0.95;
        }
        .lnf-btn:active {
          transform: translateY(0);
        }

        @media (max-width: 480px) {
          .lnf-card { padding: 2rem 1.5rem; }
          .lnf-code { font-size: 3.5rem; }
        }
      `}</style>
    </main>
  );
}
