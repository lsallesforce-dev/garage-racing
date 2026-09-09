"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useUserRole } from "@/components/SidebarWrapper";
import PublicarMetaButton from "@/components/PublicarMetaButton";
import { midiaDoVeiculo, melhorFormato } from "@/lib/veiculo-midia";
import { Car, Check, Download, Loader2, Megaphone, Plus, RotateCcw, Store, Trash2, X, Zap } from "lucide-react";

/**
 * Ação "Anunciar" no card do estoque.
 * Meta abre o mesmo modal usado em /marketing (reuso, nada novo); os portais
 * (OLX/Webmotors/ML) continuam morando em /marketing → Portais, então aqui vai
 * só um atalho pra lá em vez de duplicar aquele fluxo.
 */
function AnunciarEstoque({ carro }: { carro: any }) {
  const [aberto, setAberto] = useState(false);
  const [menu, setMenu] = useState(false);
  const midia = midiaDoVeiculo(carro);
  const semArte = midia.formatosDisponiveis.length === 0;

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setMenu(v => !v)}
          onBlur={() => setTimeout(() => setMenu(false), 180)}
          className="flex items-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-[10px] font-black uppercase italic rounded-2xl hover:from-blue-700 hover:to-purple-700 transition-all tracking-widest shadow-lg shadow-blue-200"
        >
          <Megaphone size={14} /> Anunciar
        </button>

        {menu && (
          <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-100 rounded-2xl shadow-xl z-30 overflow-hidden">
            <button
              onMouseDown={() => { setMenu(false); if (!semArte) setAberto(true); }}
              disabled={semArte}
              className="w-full flex items-start gap-2.5 px-4 py-3 hover:bg-blue-50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Megaphone size={13} className="text-blue-600 mt-0.5 shrink-0" />
              <span>
                <span className="block text-[11px] font-black text-gray-900">Meta Ads</span>
                <span className="block text-[9px] text-gray-400">
                  {semArte ? "Adicione uma foto primeiro" : `Facebook e Instagram · ${melhorFormato(midia)}`}
                </span>
              </span>
            </button>
            <Link
              href="/marketing?tab=portais"
              className="w-full flex items-start gap-2.5 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-t border-gray-50"
            >
              <Store size={13} className="text-gray-500 mt-0.5 shrink-0" />
              <span>
                <span className="block text-[11px] font-black text-gray-900">Portais</span>
                <span className="block text-[9px] text-gray-400">OLX, Webmotors e Mercado Livre</span>
              </span>
            </Link>
          </div>
        )}
      </div>

      {aberto && (
        <PublicarMetaButton
          veiculoId={carro.id}
          marca={carro.marca ?? ""}
          modelo={carro.modelo ?? ""}
          ano={carro.ano_modelo ?? carro.ano ?? ""}
          fotoUrl={midia.imagemPadrao}
          formatoInicial={melhorFormato(midia)}
          defaultOpen
          onClose={() => setAberto(false)}
        />
      )}
    </>
  );
}

export default function ListaEstoque() {
  const { effectiveUserId, isVendedor } = useUserRole();
  const [carros, setCarros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);

  // Filtros
  const [filtroMarca, setFiltroMarca] = useState("");
  const [filtroModelo, setFiltroModelo] = useState("");
  const [filtroAno, setFiltroAno] = useState("");
  const [filtroValorMin, setFiltroValorMin] = useState("");
  const [filtroValorMax, setFiltroValorMax] = useState("");

  // Download das fotos do carro (ZIP montado no navegador).
  const [baixandoId, setBaixandoId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    const res = await fetch("/api/veiculo/deletar", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ veiculoId: id }),
    });
    if (res.ok) {
      setCarros(prev => prev.filter(c => c.id !== id));
    }
    setConfirmandoId(null);
  };

  useEffect(() => {
    const buscarEstoque = async () => {
      if (!effectiveUserId) return;
      setLoading(true);
      const { data } = await supabase
        .from('veiculos')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('status_venda', { ascending: true })
        .order('created_at', { ascending: false });
      if (data) setCarros(data);
      setLoading(false);
    };
    buscarEstoque();
  }, [effectiveUserId]);

  // Baixa as fotos do carro num ZIP.
  //
  // Uma a uma não funciona: as fotos vivem no Storage do Supabase (outro
  // domínio), e o atributo `download` de <a> é IGNORADO em URL cross-origin — o
  // navegador abre a imagem numa aba em vez de salvar. Fora que disparar N
  // downloads seguidos é bloqueado depois dos primeiros.
  //
  // O ZIP é montado no NAVEGADOR de propósito: passando por uma rota nossa, um
  // carro com 15 fotos daria uma resposta de ~12 MB e esbarraria no limite de
  // resposta da função na Vercel.
  const baixarFotos = async (carro: any) => {
    const fotos: string[] = Array.isArray(carro.fotos) ? carro.fotos.filter(Boolean) : [];
    if (!fotos.length) {
      alert("Este veículo ainda não tem fotos cadastradas.");
      return;
    }

    setBaixandoId(carro.id);
    try {
      // import dinâmico: o jszip só entra no bundle de quem clica.
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();

      const base =
        [carro.marca, carro.modelo, carro.ano_modelo].filter(Boolean).join(" ")
          .toLowerCase()
          .normalize("NFD").replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "veiculo";

      // Uma foto que falhe não derruba as outras — melhor ZIP com 9 de 10 do que
      // erro seco depois de o usuário esperar.
      let baixadas = 0;
      await Promise.all(
        fotos.map(async (url, i) => {
          try {
            const res = await fetch(url);
            if (!res.ok) return;
            const blob = await res.blob();
            const ext = (url.split("?")[0].split(".").pop() || "jpg").slice(0, 4);
            zip.file(`${base}-${String(i + 1).padStart(2, "0")}.${ext}`, blob);
            baixadas++;
          } catch {
            /* ignora a foto que falhou */
          }
        })
      );

      if (!baixadas) {
        alert("Não consegui baixar as fotos. Verifique a conexão e tente de novo.");
        return;
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const href = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${base}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);

      if (baixadas < fotos.length) {
        alert(`Baixei ${baixadas} de ${fotos.length} fotos — as demais falharam.`);
      }
    } finally {
      setBaixandoId(null);
    }
  };

  const estornarVenda = async (id: string) => {
    if (!confirm("Estornar a venda? O carro voltará para o estoque como DISPONÍVEL.")) return;
    await fetch("/api/veiculo/patch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        veiculoId: id,
        fields: {
          status_venda: "DISPONIVEL",
          preco_venda_final: null,
          data_venda: null,
          vendedor_id: null,
          cliente_id: null,
        },
      }),
    });
    setCarros(prev => prev.map(c => c.id === id ? { ...c, status_venda: "DISPONIVEL", preco_venda_final: null, data_venda: null } : c));
  };

  // Listas únicas para os dropdowns
  const marcasUnicas = [...new Set(carros.map(c => c.marca).filter(Boolean))].sort();
  const anosUnicos = [...new Set(carros.map(c => c.ano_modelo || c.ano_fabricacao).filter(Boolean))].sort((a, b) => b - a);

  // Carros filtrados
  const carrosFiltrados = carros.filter(c => {
    if (filtroMarca && c.marca?.toLowerCase() !== filtroMarca.toLowerCase()) return false;
    if (filtroModelo && !`${c.marca} ${c.modelo} ${c.versao}`.toLowerCase().includes(filtroModelo.toLowerCase())) return false;
    if (filtroAno && String(c.ano_modelo || c.ano_fabricacao) !== filtroAno) return false;
    if (filtroValorMin && (c.preco_sugerido || 0) < Number(filtroValorMin)) return false;
    if (filtroValorMax && (c.preco_sugerido || 0) > Number(filtroValorMax)) return false;
    return true;
  });

  const temFiltro = filtroMarca || filtroModelo || filtroAno || filtroValorMin || filtroValorMax;

  return (
    <div className="p-4 md:p-10 bg-[#f4f4f2] min-h-screen font-sans overflow-y-auto w-full">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end mb-6 md:mb-8">
            <div>
                <h1 className="text-4xl md:text-6xl font-black italic uppercase text-gray-300 leading-none mb-2 tracking-tighter">Estoque Inteligente</h1>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">Gerenciamento completo do pátio digital.</p>
            </div>
            <Link href="/upload" className="self-start sm:self-auto px-6 py-3 md:px-8 md:py-4 bg-red-600 text-white font-black uppercase italic rounded-2xl shadow-xl shadow-red-200 flex items-center gap-2 hover:scale-105 transition-all tracking-widest text-[10px]">
                <Plus size={18} strokeWidth={3} /> Cadastrar Nova Máquina
              </Link>
        </div>

        {/* ── Contadores + Filtros num único card ── */}
        <div className="bg-white rounded-2xl md:rounded-3xl border border-gray-100 shadow-sm mb-6 overflow-hidden">
          {/* Contadores */}
          <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <Car size={15} className="text-emerald-600" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 leading-tight">Em Estoque</p>
                <p className="text-xl font-black italic text-gray-900 leading-none">
                  {loading ? "—" : carros.filter(c => c.status_venda !== 'VENDIDO').length}
                </p>
              </div>
            </div>
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Check size={15} className="text-slate-700" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 leading-tight">Vendidos</p>
                <p className="text-xl font-black italic text-gray-900 leading-none">
                  {loading ? "—" : carros.filter(c => c.status_venda === 'VENDIDO').length}
                </p>
              </div>
            </div>
          </div>

          {/* Filtros */}
          <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            {/* Marca */}
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-1">Marca</label>
              <select
                value={filtroMarca}
                onChange={e => setFiltroMarca(e.target.value)}
                className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-700 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 transition-all"
              >
                <option value="">Todas</option>
                {marcasUnicas.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* Modelo */}
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-1">Modelo</label>
              <input
                type="text"
                value={filtroModelo}
                onChange={e => setFiltroModelo(e.target.value)}
                placeholder="Ex: Onix, T-Cross..."
                className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-700 placeholder-gray-300 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 transition-all"
              />
            </div>

            {/* Ano */}
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-1">Ano</label>
              <select
                value={filtroAno}
                onChange={e => setFiltroAno(e.target.value)}
                className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-700 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 transition-all"
              >
                <option value="">Todos</option>
                {anosUnicos.map(a => <option key={a} value={String(a)}>{a}</option>)}
              </select>
            </div>

            {/* Valor */}
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-1">Valor (R$)</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  value={filtroValorMin}
                  onChange={e => setFiltroValorMin(e.target.value)}
                  placeholder="Mín"
                  className="w-1/2 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-700 placeholder-gray-300 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 transition-all"
                />
                <input
                  type="number"
                  value={filtroValorMax}
                  onChange={e => setFiltroValorMax(e.target.value)}
                  placeholder="Máx"
                  className="w-1/2 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-700 placeholder-gray-300 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Resultado + limpar */}
          {temFiltro && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-gray-50 bg-gray-50/50">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {carrosFiltrados.length} resultado{carrosFiltrados.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => { setFiltroMarca(""); setFiltroModelo(""); setFiltroAno(""); setFiltroValorMin(""); setFiltroValorMax(""); }}
                className="text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-700 transition-colors flex items-center gap-1"
              >
                <X size={11} /> Limpar filtros
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4">
            {!loading ? (
                carrosFiltrados.length > 0 ? carrosFiltrados.map((carro) => (
                <div key={carro.id} className="bg-white p-4 md:p-6 rounded-[2rem] md:rounded-[2.5rem] border border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-sm hover:shadow-xl transition-all group">
                    <div className="flex items-center gap-4">
                    <div className="w-24 h-16 md:w-32 md:h-20 flex-shrink-0 bg-gray-100 rounded-2xl overflow-hidden relative">
                        <img
                            src={carro.capa_marketing_url || (carro.fotos?.[0] || 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=2070&auto=format&fit=crop')}
                            alt={carro.modelo}
                            className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-700"
                        />
                        {carro.status_venda === 'VENDIDO' && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <span className="text-[8px] font-black uppercase tracking-widest text-white border border-white/20 px-2 py-1 rounded-md">Vendido</span>
                            </div>
                        )}
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-base md:text-xl font-black uppercase italic leading-none text-gray-900 group-hover:text-red-600 transition-colors truncate max-w-xs md:max-w-sm mb-1" title={`${carro.marca} ${carro.modelo}`}>{carro.marca} {carro.modelo}</h3>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">
                            {carro.versao || 'Configuração Esportiva'} • {carro.ano_modelo || '2024'}
                        </p>
                        <p className="text-[11px] font-black text-slate-900 mt-2 tracking-tighter">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(carro.preco_sugerido || 0)}
                        </p>
                    </div>
                    </div>

                    <div className="flex flex-wrap gap-2 items-center">
                        {confirmandoId === carro.id ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-black uppercase text-gray-500">Tem certeza?</span>
                            <button
                              onClick={() => handleDelete(carro.id)}
                              className="px-4 py-2 bg-red-600 text-white text-[10px] font-black uppercase rounded-xl hover:bg-red-700 transition-all"
                            >Apagar</button>
                            <button
                              onClick={() => setConfirmandoId(null)}
                              className="px-4 py-2 bg-gray-100 text-gray-600 text-[10px] font-black uppercase rounded-xl hover:bg-gray-200 transition-all"
                            >Cancelar</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmandoId(carro.id)}
                            className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        {carro.status_venda === "VENDIDO" ? (
                          <button
                            onClick={() => estornarVenda(carro.id)}
                            className="flex items-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-amber-500 text-white text-[10px] font-black uppercase italic rounded-2xl hover:bg-amber-600 transition-all tracking-widest shadow-lg shadow-amber-200"
                          >
                            <RotateCcw size={14} /> Estornar Venda
                          </button>
                        ) : (
                          <button
                            onClick={() => baixarFotos(carro)}
                            disabled={baixandoId === carro.id}
                            className="flex items-center gap-2 px-4 py-3 md:px-6 md:py-4 bg-green-600 text-white text-[10px] font-black uppercase italic rounded-2xl hover:bg-green-700 disabled:opacity-60 disabled:cursor-wait transition-all tracking-widest shadow-lg shadow-green-200"
                          >
                            {baixandoId === carro.id ? (
                              <><Loader2 size={14} className="animate-spin" /> Baixando…</>
                            ) : (
                              <><Download size={14} /> Baixar Fotos</>
                            )}
                          </button>
                        )}
                        {/* Anunciar direto do estoque — antes a página só listava
                            e editava; toda publicação vivia em /marketing. */}
                        {carro.status_venda !== "VENDIDO" && (
                          <AnunciarEstoque carro={carro} />
                        )}
                        <Link
                            href={`/veiculo/${carro.id}`}
                            className="flex items-center gap-2 px-4 py-3 md:px-8 md:py-4 bg-slate-900 text-white text-[10px] font-black uppercase italic rounded-2xl hover:bg-red-600 transition-all tracking-widest shadow-lg shadow-slate-200"
                        >
                            <Zap size={14} className="fill-white" /> Painel do Carro
                        </Link>
                    </div>
                </div>
                )) : (
                    <div className="py-32 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100 italic font-black uppercase text-gray-300 tracking-widest text-xs">
                      {temFiltro ? "Nenhum veículo encontrado com esses filtros." : "O estoque está vazio. Comece a acelerar!"}
                    </div>
                )
            ) : (
                <div className="py-32 text-center flex flex-col items-center">
                    <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin"></div>
                </div>
            )}
        </div>
      </div>

    </div>
  );
}
