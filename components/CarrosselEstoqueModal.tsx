"use client";

// components/CarrosselEstoqueModal.tsx
//
// Carrossel de estoque: N carros viram N cards, cada card abre a página daquele
// carro na vitrine. Pedido da APROVE na reunião de 10/09/2026.
//
// Não reaproveita PublicarMetaButton de propósito: aquele modal é por veículo do
// prop até o preview (lê midia.carrossel, que são as artes de um carro só) e
// carrega toda a régua de segmentação — geo, idade, interesses, comportamentos.
// Aqui a segmentação é DELIBERADAMENTE menor: só público salvo.
//
// O motivo do público salvo obrigatório é uma cicatriz: campanha criada à mão no
// Gerenciador nasce com "Localizações: Brasil", e o público salvo não é aplicado
// sozinho. Isso custou 16 leads de outro estado à APROVE em 3 dias. Fechar a
// porta por construção sai mais barato que lembrar de conferir toda vez.
// Quem precisa de segmentação fina usa o anúncio por carro, que já existe.

import { useEffect, useMemo, useState } from "react";
import { X, Layers, Loader2, Check, AlertTriangle, ExternalLink } from "lucide-react";

const MAX_CARDS = 10; // teto da Meta por carrossel

interface VeiculoLite {
  id: string;
  marca?: string | null;
  modelo?: string | null;
  ano?: string | number | null;
  ano_modelo?: string | number | null;
  preco_sugerido?: number | null;
  status_venda?: string | null;
}

interface PublicoSalvo {
  id: string;
  nome: string;
  cidades: { key: string | null; nome: string; lat?: number; lng?: number; radiusKm: number | null }[];
  idadeMin: number | null;
  idadeMax: number | null;
}

type EstadoGrupo =
  | { fase: "espera" }
  | { fase: "subindo" }
  | { fase: "ok"; campaignId: string; otimizacao: string }
  | { fase: "erro"; msg: string };

interface Props {
  veiculos: VeiculoLite[];
  onClose: () => void;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const nomeDe = (v: VeiculoLite) => `${v.marca ?? ""} ${v.modelo ?? ""} ${v.ano_modelo ?? v.ano ?? ""}`.replace(/\s+/g, " ").trim();

export default function CarrosselEstoqueModal({ veiculos, onClose }: Props) {
  const disponiveis = useMemo(
    () => veiculos.filter((v) => v.status_venda !== "VENDIDO"),
    [veiculos],
  );

  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set(disponiveis.map((v) => v.id)));
  const [dividirPor, setDividirPor]     = useState<"chegada" | "preco">("chegada");
  const [tamanhoGrupo, setTamanhoGrupo] = useState(MAX_CARDS);

  const [publicos, setPublicos]   = useState<PublicoSalvo[]>([]);
  const [publicoSel, setPublicoSel] = useState<string | null>(null);
  const [carregandoPublicos, setCarregandoPublicos] = useState(true);

  const [orcamentoDiario, setOrcamentoDiario] = useState(30);
  const [duracaoDias, setDuracaoDias]         = useState(7);
  const [legenda, setLegenda]                 = useState("");
  const [comecarPausado, setComecarPausado]   = useState(true);

  const [publicando, setPublicando] = useState(false);
  const [estados, setEstados]       = useState<Record<number, EstadoGrupo>>({});
  const [erroGeral, setErroGeral]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/meta/publicos")
      .then((r) => r.json())
      .then((d) => setPublicos(d.publicos ?? []))
      .catch(() => setPublicos([]))
      .finally(() => setCarregandoPublicos(false));
  }, []);

  const toggle = (id: string) =>
    setSelecionados((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  // Grupos. "chegada" preserva a ordem que veio do estoque (created_at desc);
  // "preço" ordena crescente, o que dá grupos com faixa de preço coerente —
  // é o "uns 3 pra dividir" que eles pediram, sem precisar montar na mão.
  //
  // A distribuição é EQUILIBRADA, não fatia de N em N: com 31 carros e teto 10,
  // fatiar direto daria 10/10/10/1, e um grupo de 1 não é carrossel (a Meta
  // exige 2 cards) — aquele carro ficaria de fora sozinho. Equilibrando dá
  // 8/8/8/7. O "carros por carrossel" vira teto, não tamanho fixo.
  const grupos = useMemo(() => {
    const lista = disponiveis.filter((v) => selecionados.has(v.id));
    const ordenada = dividirPor === "preco"
      ? [...lista].sort((a, b) => (a.preco_sugerido ?? Infinity) - (b.preco_sugerido ?? Infinity))
      : lista;
    if (!ordenada.length) return [];

    const nGrupos = Math.ceil(ordenada.length / tamanhoGrupo);
    const base    = Math.floor(ordenada.length / nGrupos);
    const resto   = ordenada.length % nGrupos; // os primeiros levam um a mais

    const out: VeiculoLite[][] = [];
    let i = 0;
    for (let g = 0; g < nGrupos; g++) {
      const tam = base + (g < resto ? 1 : 0);
      out.push(ordenada.slice(i, i + tam));
      i += tam;
    }
    return out;
  }, [disponiveis, selecionados, dividirPor, tamanhoGrupo]);

  const gruposValidos = grupos.filter((g) => g.length >= 2);
  const sobrando = grupos.filter((g) => g.length < 2).flat();

  const publicoEscolhido = publicos.find((p) => p.id === publicoSel) ?? null;
  const podePublicar = !!publicoEscolhido && gruposValidos.length > 0 && !publicando;

  const publicar = async () => {
    if (!publicoEscolhido) return;
    setPublicando(true);
    setErroGeral(null);
    setEstados({});

    const cidadesExtras = publicoEscolhido.cidades.map((c) => ({
      key: c.key ?? null, nome: c.nome, lat: c.lat, lng: c.lng, radiusKm: c.radiusKm,
    }));

    // Em série, não em paralelo: cada grupo sobe até 10 imagens pro /adimages, e
    // disparar 4 grupos juntos multiplicaria isso por 4 na mesma janela.
    for (let i = 0; i < gruposValidos.length; i++) {
      setEstados((p) => ({ ...p, [i]: { fase: "subindo" } }));
      try {
        const res = await fetch("/api/meta/ads/criar-estoque", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            veiculoIds: gruposValidos[i].map((v) => v.id),
            placement: "facebook,instagram",
            orcamentoDiario,
            duracaoDias,
            tipoOrcamento: "diario",
            idadeMin: publicoEscolhido.idadeMin ?? 25,
            idadeMax: publicoEscolhido.idadeMax ?? 55,
            cidadesExtras,
            usarRaioPorCidade: true,
            legenda: legenda.trim() || null,
            nomeGrupo: `Grupo ${i + 1}/${gruposValidos.length}`,
            statusInicial: comecarPausado ? "PAUSED" : "ACTIVE",
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        setEstados((p) => ({
          ...p,
          [i]: { fase: "ok", campaignId: data.campaignId, otimizacao: data.optimizationGoal ?? "" },
        }));
      } catch (e: any) {
        // Um grupo que falha não aborta os outros: o lojista prefere 3 de 4 no ar
        // a nenhum, e o que falhou fica visível pra tentar de novo.
        setEstados((p) => ({ ...p, [i]: { fase: "erro", msg: e?.message ?? "falha desconhecida" } }));
      }
    }
    setPublicando(false);
  };

  const concluidos = Object.values(estados).filter((e) => e.fase === "ok").length;
  const falhados   = Object.values(estados).filter((e) => e.fase === "erro").length;
  const terminou   = !publicando && concluidos + falhados > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-3xl max-h-[92vh] rounded-t-[2rem] sm:rounded-[2rem] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            <Layers size={18} className="text-indigo-600" />
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-gray-900">Carrossel do Estoque</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Cada card abre a página do carro na sua vitrine
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-300 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-6 flex flex-col gap-7">
          {/* 1. Carros */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                1. Carros — {selecionados.size} de {disponiveis.length}
              </h3>
              <div className="flex gap-1">
                <button
                  onClick={() => setSelecionados(new Set(disponiveis.map((v) => v.id)))}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-gray-400 hover:text-gray-900"
                >
                  Todos
                </button>
                <button
                  onClick={() => setSelecionados(new Set())}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-gray-400 hover:text-gray-900"
                >
                  Nenhum
                </button>
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto border border-gray-100 rounded-2xl divide-y divide-gray-50">
              {disponiveis.map((v) => {
                const on = selecionados.has(v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() => toggle(v.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${on ? "bg-indigo-50/40" : "hover:bg-gray-50"}`}
                  >
                    <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${on ? "bg-indigo-600" : "border-2 border-gray-200"}`}>
                      {on && <Check size={11} className="text-white" strokeWidth={3} />}
                    </span>
                    <span className="flex-1 text-xs font-bold text-gray-700 truncate">{nomeDe(v)}</span>
                    <span className="text-[11px] font-black text-gray-400 shrink-0">
                      {v.preco_sugerido ? brl(v.preco_sugerido) : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Divisão */}
          <section>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">2. Como dividir</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {([["chegada", "Por chegada"], ["preco", "Por preço"]] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setDividirPor(id)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                    dividirPor === id ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-400 hover:text-gray-700"
                  }`}
                >
                  {label}
                </button>
              ))}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Máx. por carrossel</span>
                <select
                  value={tamanhoGrupo}
                  onChange={(e) => setTamanhoGrupo(Number(e.target.value))}
                  className="bg-gray-50 rounded-xl px-3 py-2 text-xs font-black text-gray-900 focus:outline-none"
                >
                  {[4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            {gruposValidos.length === 0 ? (
              <p className="text-[11px] font-bold text-gray-400">Selecione pelo menos 2 carros.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {gruposValidos.map((g, i) => {
                  const st = estados[i];
                  return (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2.5">
                      <span className="text-[10px] font-black uppercase tracking-wider text-gray-900 shrink-0">
                        Grupo {i + 1}
                      </span>
                      <span className="text-[11px] font-bold text-gray-500 truncate flex-1">
                        {g.length} carros · {g.map(nomeDe).join(" · ")}
                      </span>
                      {st?.fase === "subindo" && <Loader2 size={14} className="animate-spin text-indigo-600 shrink-0" />}
                      {st?.fase === "ok"     && <Check size={14} className="text-emerald-600 shrink-0" strokeWidth={3} />}
                      {st?.fase === "erro"   && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
                    </div>
                  );
                })}
                {sobrando.length > 0 && (
                  <p className="text-[11px] font-bold text-amber-600 mt-1">
                    {sobrando.map(nomeDe).join(", ")} ficou de fora: a Meta exige 2 cards no mínimo por carrossel.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 3. Público */}
          <section>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">3. Público salvo</h3>
            <p className="text-[11px] font-bold text-gray-400 mb-3">
              Obrigatório. Sem ele o anúncio nasce mirando o Brasil inteiro.
            </p>
            {carregandoPublicos ? (
              <Loader2 size={16} className="animate-spin text-gray-300" />
            ) : publicos.length === 0 ? (
              <p className="text-[11px] font-bold text-red-500">
                Nenhum público salvo na conta. Crie um no Gerenciador de Anúncios da Meta e recarregue esta página.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {publicos.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPublicoSel((prev) => (prev === p.id ? null : p.id))}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                      publicoSel === p.id ? "bg-indigo-600 text-white" : "bg-gray-50 text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {p.nome}
                    {p.cidades.length > 0 && (
                      <span className="opacity-60"> · {p.cidades.length} {p.cidades.length === 1 ? "cidade" : "cidades"}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 4. Orçamento e texto */}
          <section className="flex flex-col gap-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">4. Orçamento e texto</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">R$ / dia por carrossel</span>
                <input
                  type="number" min={6} value={orcamentoDiario}
                  onChange={(e) => setOrcamentoDiario(Number(e.target.value))}
                  className="bg-gray-50 rounded-xl px-4 py-2.5 text-sm font-black text-gray-900 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Dias</span>
                <input
                  type="number" min={1} value={duracaoDias}
                  onChange={(e) => setDuracaoDias(Number(e.target.value))}
                  className="bg-gray-50 rounded-xl px-4 py-2.5 text-sm font-black text-gray-900 focus:outline-none"
                />
              </label>
            </div>
            {gruposValidos.length > 0 && (
              <p className="text-[11px] font-bold text-gray-400">
                {gruposValidos.length} {gruposValidos.length === 1 ? "carrossel" : "carrosséis"} ×{" "}
                {brl(orcamentoDiario)}/dia = <strong className="text-gray-900">{brl(orcamentoDiario * gruposValidos.length)}/dia</strong>
                {" "}· {brl(orcamentoDiario * gruposValidos.length * duracaoDias)} em {duracaoDias} dias
              </p>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Texto do anúncio (opcional)</span>
              <textarea
                rows={3} value={legenda} onChange={(e) => setLegenda(e.target.value)}
                placeholder="Vazio = o AutoZap escreve um convite pra deslizar o carrossel."
                className="bg-gray-50 rounded-xl px-4 py-3 text-xs font-medium text-gray-900 focus:outline-none resize-none"
              />
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox" checked={comecarPausado}
                onChange={(e) => setComecarPausado(e.target.checked)}
                className="w-4 h-4 accent-indigo-600"
              />
              <span className="text-[11px] font-bold text-gray-600">
                Criar pausado pra eu conferir os cards antes de gastar
              </span>
            </label>
          </section>

          {erroGeral && (
            <p className="text-[11px] font-bold text-red-500">{erroGeral}</p>
          )}

          {/* Resultado */}
          {terminou && (
            <div className="flex flex-col gap-2 bg-gray-50 rounded-2xl p-4">
              <p className="text-[11px] font-black uppercase tracking-wider text-gray-900">
                {concluidos} no ar{falhados > 0 ? ` · ${falhados} com erro` : ""}
                {comecarPausado && concluidos > 0 ? " (pausados)" : ""}
              </p>
              {gruposValidos.map((_, i) => {
                const st = estados[i];
                if (st?.fase !== "erro") return null;
                return (
                  <p key={i} className="text-[11px] font-bold text-red-500">
                    Grupo {i + 1}: {st.msg}
                  </p>
                );
              })}
              {concluidos > 0 && (
                <a
                  href="https://adsmanager.facebook.com/adsmanager"
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-indigo-600 hover:opacity-70"
                >
                  Conferir no Gerenciador <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            {gruposValidos.length > 0
              ? `${gruposValidos.length} ${gruposValidos.length === 1 ? "campanha" : "campanhas"} · ${gruposValidos.flat().length} carros`
              : "—"}
          </span>
          <button
            onClick={publicar}
            disabled={!podePublicar}
            className="px-6 py-3 rounded-2xl bg-gray-900 text-white text-[10px] font-black uppercase tracking-wider hover:bg-indigo-600 transition-all disabled:opacity-30 disabled:hover:bg-gray-900 flex items-center gap-2"
          >
            {publicando && <Loader2 size={13} className="animate-spin" />}
            {publicando ? "Publicando…" : "Publicar carrosséis"}
          </button>
        </div>
      </div>
    </div>
  );
}
