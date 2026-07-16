"use client";

// Aba Clientes — lista enxuta: dados de leitura + botão "Abrir" (drawer) e
// menu kebab com as ações secundárias. A linha expandida antiga morreu; tudo
// que era dela (plano, indicação, deletar...) agora vive no ClienteDrawer.

import { useState } from "react";
import { Loader2, Eye, ExternalLink, Lock, Unlock, MoreVertical, Pause, Play } from "lucide-react";
import {
  Tenant, planoStatus, fmtDate, fmtDiaMes,
  TenantAvatar, PlanoBadge, AtividadeBadge,
} from "./types";

export default function ClientesTab({ tenants, acao, acaoLoading, impersonate, onAbrir }: {
  tenants: Tenant[];
  acao: (user_id: string, act: string, val?: string) => void;
  acaoLoading: string | null;
  impersonate: (user_id: string, nome: string) => void;
  onAbrir: (t: Tenant) => void;
}) {
  const [search, setSearch] = useState("");
  const [filtroPlano, setFiltroPlano] = useState<"todos" | "trial" | "ativo" | "expirado" | "bloqueado" | "demo">("todos");
  // Kebab aberto: posição fixa calculada no clique (o container da tabela tem
  // overflow-hidden — dropdown absoluto seria cortado nas últimas linhas).
  const [kebab, setKebab] = useState<{ userId: string; x: number; y: number } | null>(null);

  // Filtros — busca por nome, e-mail, WhatsApp (só dígitos) ou webhook_token
  const tenantsFiltrados = tenants.filter(t => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    const matchSearch = !q ||
      t.nome_empresa?.toLowerCase().includes(q) ||
      t.email?.toLowerCase().includes(q) ||
      (qDigits.length >= 4 && (t.whatsapp ?? "").replace(/\D/g, "").includes(qDigits)) ||
      t.webhook_token?.toLowerCase().includes(q);
    const ps = planoStatus(t);
    const matchPlano =
      filtroPlano === "todos" ? true :
      filtroPlano === "bloqueado" ? !!t.bloqueado :
      ps === filtroPlano;
    return matchSearch && matchPlano;
  });

  function abrirKebab(e: React.MouseEvent<HTMLButtonElement>, userId: string) {
    if (kebab?.userId === userId) { setKebab(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setKebab({ userId, x: r.right, y: r.bottom + 4 });
  }

  const kebabTenant = kebab ? tenantsFiltrados.find(t => t.user_id === kebab.userId) ?? tenants.find(t => t.user_id === kebab.userId) : null;

  const kebabItemCls = "w-full flex items-center gap-2 px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest transition";

  return (
    <div className="flex flex-col gap-6">

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <input type="text" placeholder="Buscar por nome, e-mail, WhatsApp ou token..." value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-red-500 w-72"
        />
        <div className="flex gap-1.5">
          {(["todos", "ativo", "trial", "expirado", "demo", "bloqueado"] as const).map(f => (
            <button key={f} onClick={() => setFiltroPlano(f)}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition ${
                filtroPlano === f ? "bg-gray-900 text-white shadow" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}>
              {f}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500 font-bold ml-auto">{tenantsFiltrados.length} resultado(s)</span>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              {["Empresa", "Plano", "Cobrança", "Veíc.", "Leads", "Atividade", "Ações"].map(h => (
                <th key={h} className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tenantsFiltrados.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-16 text-sm text-gray-300 font-black uppercase tracking-widest">Nenhum resultado</td></tr>
            ) : tenantsFiltrados.map(t => (
              <tr key={t.user_id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                {/* Empresa */}
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <TenantAvatar t={t} />
                    <div>
                      <p className="text-sm font-black text-gray-900 uppercase tracking-tight">{t.nome_empresa}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Desde {fmtDate(t.created_at)}
                        {t.bloqueado && <span className="ml-1.5 text-red-500 font-bold">· BLOQUEADO</span>}
                      </p>
                    </div>
                  </div>
                </td>
                {/* Plano */}
                <td className="px-4 py-4">
                  <PlanoBadge t={t} />
                  {planoStatus(t) === "ativo" && t.plano_vence_em && (
                    <p className="text-[11px] text-gray-400 mt-1">vence {fmtDiaMes(t.plano_vence_em)}</p>
                  )}
                </td>
                {/* Cobrança — régua automática ligada/manual */}
                <td className="px-4 py-4">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border whitespace-nowrap ${
                    t.cobranca_automatica
                      ? "bg-green-50 text-green-700 border-green-100"
                      : "bg-gray-100 text-gray-400 border-gray-200"
                  }`}>
                    {t.cobranca_automatica ? "Auto ✓" : "Manual"}
                  </span>
                  {t.cobranca_ultimo_aviso_em && (
                    <p className="text-[11px] text-gray-400 mt-1">último aviso {fmtDiaMes(t.cobranca_ultimo_aviso_em)}</p>
                  )}
                </td>
                {/* Veículos */}
                <td className="px-4 py-4"><span className="text-base font-black text-gray-900">{t.veiculos}</span></td>
                {/* Leads */}
                <td className="px-4 py-4"><span className="text-base font-black text-gray-900">{t.leads}</span></td>
                {/* Atividade (conversa 7d — não é status do plano) */}
                <td className="px-4 py-4">
                  <AtividadeBadge t={t} />
                  {t.ultima_msg_at && (
                    <p className="text-[11px] text-gray-400 mt-1">{fmtDate(t.ultima_msg_at)}</p>
                  )}
                </td>
                {/* Ações: Abrir (drawer) + kebab */}
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => onAbrir(t)}
                      className="px-4 py-2 bg-gray-900 hover:bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition">
                      Abrir
                    </button>
                    <button onClick={e => abrirKebab(e, t.user_id)}
                      title="Mais ações"
                      className={`p-2.5 rounded-lg transition ${
                        kebab?.userId === t.user_id ? "text-gray-900 bg-gray-100" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                      }`}>
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Menu kebab — renderizado fixed pra não ser cortado pelo overflow da tabela */}
      {kebab && kebabTenant && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setKebab(null)} />
          <div className="fixed z-50 w-56 bg-white rounded-2xl border border-gray-100 shadow-2xl py-2 overflow-hidden"
            style={{ top: kebab.y, left: Math.max(8, kebab.x - 224) }}>
            {/* Entrar como cliente (impersonate) */}
            <button onClick={() => { setKebab(null); impersonate(kebabTenant.user_id, kebabTenant.nome_empresa); }}
              disabled={acaoLoading === `${kebabTenant.user_id}-imp`}
              className={`${kebabItemCls} text-gray-600 hover:bg-gray-50 disabled:opacity-50`}>
              {acaoLoading === `${kebabTenant.user_id}-imp` ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
              Entrar como cliente
            </button>
            {/* Ver vitrine */}
            {kebabTenant.vitrine_slug && (
              <a href={`/vitrine/${kebabTenant.vitrine_slug}`} target="_blank"
                onClick={() => setKebab(null)}
                className={`${kebabItemCls} text-gray-600 hover:bg-gray-50`}>
                <ExternalLink size={13} /> Ver vitrine
              </a>
            )}
            {/* Pausar/Ativar plano */}
            {planoStatus(kebabTenant) !== "ativo" ? (
              <button onClick={() => { setKebab(null); acao(kebabTenant.user_id, "ativar"); }}
                disabled={acaoLoading === `${kebabTenant.user_id}-ativar`}
                className={`${kebabItemCls} text-green-700 hover:bg-green-50 disabled:opacity-50`}>
                <Play size={13} /> Ativar plano
              </button>
            ) : (
              <button onClick={() => { setKebab(null); acao(kebabTenant.user_id, "desativar"); }}
                disabled={acaoLoading === `${kebabTenant.user_id}-desativar`}
                className={`${kebabItemCls} text-gray-600 hover:bg-gray-50 disabled:opacity-50`}>
                <Pause size={13} /> Pausar plano
              </button>
            )}
            {/* Bloquear/Desbloquear */}
            {kebabTenant.bloqueado ? (
              <button onClick={() => { setKebab(null); acao(kebabTenant.user_id, "desbloquear"); }}
                className={`${kebabItemCls} text-green-700 hover:bg-green-50`}>
                <Unlock size={13} /> Desbloquear
              </button>
            ) : (
              <button onClick={() => {
                setKebab(null);
                if (confirm(`Bloquear ${kebabTenant.nome_empresa}?`)) acao(kebabTenant.user_id, "bloquear");
              }}
                className={`${kebabItemCls} text-red-600 hover:bg-red-50`}>
                <Lock size={13} /> Bloquear
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
