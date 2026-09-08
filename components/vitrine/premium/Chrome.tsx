"use client";

// Cromo compartilhado do layout PREMIUM da vitrine (topbar + header + nav +
// rodapé + FAB). Home e página de detalhe usam os MESMOS componentes daqui —
// duas cópias divergiriam no primeiro item de menu novo, e o cliente perceberia
// na hora que a página do carro tem outra cara que a listagem.
//
// Nenhuma cor de marca hardcoded: tudo sai das CSS vars de `app/vitrine/theme.ts`
// (--brand, --brand-dark, --brand-fg, --accent, neutros). O verde do WhatsApp é
// cor semântica do canal, não da loja — esse fica fixo, como no layout padrão.

import Link from "next/link";
import { useState } from "react";
import { MessageCircle, MapPin, Phone, Menu, X, Clock } from "lucide-react";
import { whatsappLink } from "@/app/vitrine/theme";

export interface LojaPremium {
  cidade: string | null;
  estado: string | null;
  endereco: string | null;
  enderecoComplemento: string | null;
  horario: string | null;
  telefone: string | null;
}

export function localDaLoja(loja: LojaPremium): string {
  return [loja.cidade, loja.estado].filter(Boolean).join(" - ");
}

/** Mensagem pronta do item "Avaliar seu veículo" — não existe formulário de
 *  avaliação no produto; o canal é o mesmo WhatsApp do agente. */
export function msgAvaliacao(nomeEmpresa: string) {
  return `Olá! Quero avaliar meu veículo para troca ou venda na ${nomeEmpresa}. Pode me ajudar?`;
}

interface TopoProps {
  tenant: string;
  nomeEmpresa: string;
  logoUrl?: string | null;
  whatsapp: string;
  loja: LojaPremium;
  /** Abre a ficha de financiamento (item "Simulação" do menu). */
  onFinanciar?: () => void;
}

export function PremiumTopo({
  tenant, nomeEmpresa, logoUrl, whatsapp, loja, onFinanciar,
}: TopoProps) {
  const [menuAberto, setMenuAberto] = useState(false);
  const local = localDaLoja(loja);
  const enderecoCompleto = [loja.endereco, local].filter(Boolean).join(", ");
  const home = `/vitrine/${tenant}`;

  // Âncoras apontam pra seções da HOME com caminho absoluto — na página de
  // detalhe um "#estoque" solto não sairia do lugar.
  const nav: { label: string; href?: string; acao?: () => void }[] = [
    { label: "Início", href: home },
    { label: "Nosso estoque", href: `${home}#estoque` },
    ...(onFinanciar ? [{ label: "Simulação", acao: onFinanciar }] : []),
    { label: "Sobre nós", href: `${home}#sobre` },
    { label: "Contato", href: whatsappLink(whatsapp, msgAvaliacao(nomeEmpresa)) },
  ];

  return (
    <header className="sticky top-0 z-40">
      {/* ── Topbar: endereço + telefone ── */}
      {(enderecoCompleto || loja.telefone) && (
        <div className="hidden sm:block bg-[var(--brand-dark)] text-[var(--brand-fg)]">
          <div className="max-w-7xl mx-auto px-5 h-9 flex items-center justify-center gap-6 text-[11px] font-semibold opacity-80">
            {enderecoCompleto && (
              <span className="flex items-center gap-1.5 truncate">
                <MapPin size={12} /> {enderecoCompleto}
              </span>
            )}
            {loja.telefone && (
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <Phone size={12} /> {loja.telefone}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Faixa principal: logo + menu + CTA, tudo numa linha ── */}
      <div className="bg-[var(--brand)] text-[var(--brand-fg)]">
        <div className="max-w-7xl mx-auto px-5 h-[72px] flex items-center gap-5">
          <Link href={home} className="flex items-center shrink-0">
            {logoUrl ? (
              // Pílula branca: a logo do tenant é quase sempre desenhada pra fundo
              // claro (a da APROVE é azul-marinho) e sumia em cima da cor da marca.
              <span className="bg-white rounded-xl px-3 py-1.5 flex items-center shadow-sm">
                <img src={logoUrl} alt={nomeEmpresa} className="h-8 sm:h-9 w-auto max-w-[140px] object-contain" />
              </span>
            ) : (
              <span className="text-lg font-black uppercase italic tracking-tighter truncate max-w-[180px]">{nomeEmpresa}</span>
            )}
          </Link>

          {/* Menu na mesma linha. Abaixo de lg não cabe logo + 5 itens + botão
              verde sem espremer — aí vira hambúrguer. */}
          <nav className="hidden lg:flex items-center gap-7 mx-auto">
            {nav.map((item) =>
              item.href ? (
                <Link
                  key={item.label}
                  href={item.href}
                  {...(item.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="text-[12px] font-black uppercase tracking-widest opacity-85 hover:opacity-100 transition-opacity whitespace-nowrap"
                >
                  {item.label}
                </Link>
              ) : (
                <button
                  key={item.label}
                  onClick={item.acao}
                  className="text-[12px] font-black uppercase tracking-widest opacity-85 hover:opacity-100 transition-opacity whitespace-nowrap"
                >
                  {item.label}
                </button>
              )
            )}
          </nav>

          <a
            href={whatsappLink(whatsapp, `Olá! Vim pela vitrine da ${nomeEmpresa} e preciso de ajuda para escolher um veículo.`)}
            target="_blank" rel="noopener noreferrer"
            className="ml-auto lg:ml-0 shrink-0 hidden sm:flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-3 rounded-full text-[11px] font-black uppercase tracking-widest transition-colors"
          >
            <MessageCircle size={15} /> Falar com consultor
          </a>

          <button
            onClick={() => setMenuAberto((v) => !v)}
            aria-label="Abrir menu"
            className="ml-auto sm:ml-0 lg:hidden p-2 -mr-2 text-[var(--brand-fg)]"
          >
            {menuAberto ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* ── Menu mobile ── */}
      {menuAberto && (
        <div className="lg:hidden bg-[var(--brand-dark)] text-[var(--brand-fg)] border-t border-white/10">
          <div className="flex flex-col px-5 pb-4 pt-2">
            {nav.map((item) =>
              item.href ? (
                <Link
                  key={item.label}
                  href={item.href}
                  {...(item.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  onClick={() => setMenuAberto(false)}
                  className="py-3 text-sm font-bold border-b border-white/10 last:border-0"
                >
                  {item.label}
                </Link>
              ) : (
                <button
                  key={item.label}
                  onClick={() => { setMenuAberto(false); item.acao?.(); }}
                  className="py-3 text-sm font-bold text-left border-b border-white/10 last:border-0"
                >
                  {item.label}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </header>
  );
}

/** Seção "Onde estamos" + rodapé — idênticos nas duas telas. */
export function PremiumRodape({
  nomeEmpresa, loja, sobre, whatsapp,
}: {
  nomeEmpresa: string;
  loja: LojaPremium;
  sobre: string | null;
  whatsapp: string;
}) {
  const local = localDaLoja(loja);
  const temSecao = !!(sobre || loja.endereco || loja.horario || loja.telefone || local);

  return (
    <>
      {temSecao && (
        <section id="sobre" className="scroll-mt-32 border-t border-[var(--border)] bg-[var(--surface)]">
          <div className="max-w-7xl mx-auto px-5 py-14 grid gap-10 md:grid-cols-2">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-[var(--brand)] mb-3">Onde estamos</p>
              <h3 className="text-3xl font-black uppercase italic tracking-tight mb-4">{nomeEmpresa}</h3>
              {sobre && (
                <p className="text-sm text-[var(--fg-muted)] leading-relaxed whitespace-pre-line max-w-prose">{sobre}</p>
              )}
            </div>
            <div className="space-y-3">
              {(loja.endereco || local) && (
                <LinhaInfo icon={<MapPin size={16} />}>
                  {[loja.endereco, loja.enderecoComplemento, local].filter(Boolean).join(", ")}
                </LinhaInfo>
              )}
              {loja.horario && <LinhaInfo icon={<Clock size={16} />}>{loja.horario}</LinhaInfo>}
              {loja.telefone && <LinhaInfo icon={<Phone size={16} />}>{loja.telefone}</LinhaInfo>}
              <a
                href={whatsappLink(whatsapp, `Olá! Vim pela vitrine da ${nomeEmpresa} e quero mais informações.`)}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3.5 rounded-xl text-[12px] font-black uppercase tracking-widest transition-colors"
              >
                <MessageCircle size={15} /> Chamar no WhatsApp
              </a>
            </div>
          </div>
        </section>
      )}

      <footer className="bg-[var(--brand-dark)] text-[var(--brand-fg)] py-8 text-center">
        <p className="text-[10px] font-black uppercase tracking-widest opacity-70">
          © {new Date().getFullYear()} {nomeEmpresa} · Vitrine digital
        </p>
      </footer>
    </>
  );
}

export function PremiumFab({
  whatsapp, nomeEmpresa, className,
}: { whatsapp: string; nomeEmpresa: string; className?: string }) {
  return (
    <a
      href={whatsappLink(whatsapp, `Olá! Vim pela vitrine da ${nomeEmpresa} e preciso de ajuda para escolher um veículo.`)}
      target="_blank" rel="noopener noreferrer"
      className={`fixed bottom-5 right-5 z-40 flex items-center gap-2.5 bg-emerald-500 hover:bg-emerald-600 text-white pl-4 pr-5 py-3.5 rounded-full shadow-2xl transition-all hover:scale-105 active:scale-95 ${className ?? ""}`}
    >
      <MessageCircle size={18} strokeWidth={2.5} />
      <span className="font-black uppercase text-[10px] tracking-widest">Falar agora</span>
    </a>
  );
}

function LinhaInfo({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm text-[var(--fg-muted)]">
      <span className="text-[var(--brand)] mt-0.5 shrink-0">{icon}</span>
      <span className="leading-snug">{children}</span>
    </div>
  );
}
