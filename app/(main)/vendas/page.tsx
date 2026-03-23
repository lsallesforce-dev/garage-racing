"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  X, Plus, Trash2, DollarSign, TrendingUp, TrendingDown,
  Package, ChevronDown, Check, Loader2, Users, ReceiptText,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ItemFinanceiro {
  id: string;
  descricao: string;
  valor: number;
}

interface ItemGeral {
  id: string;
  tipo: "receita" | "despesa";
  descricao: string;
  valor: number;
  data: string;
}

interface Vendedor {
  id: string;
  nome: string;
  comissao_pct: number;
}

interface Veiculo {
  id: string;
  marca: string;
  modelo: string;
  versao: string | null;
  ano_modelo: string | null;
  placa: string | null;
  preco_sugerido: number | null;
  preco_compra: number | null;
  preco_venda_final: number | null;
  data_venda: string | null;
  status_venda: string;
  capa_marketing_url: string | null;
  fotos: string[] | null;
  vendedor_id: string | null;
  despesas?: ItemFinanceiro[];
  receitas?: ItemFinanceiro[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? null : n;
}

function calcLucro(v: Veiculo, despesas: ItemFinanceiro[], receitas: ItemFinanceiro[]): number | null {
  if (!v.preco_venda_final || !v.preco_compra) return null;
  const totalDesp = despesas.reduce((s, d) => s + d.valor, 0);
  const totalRec  = receitas.reduce((s, r) => s + r.valor, 0);
  return v.preco_venda_final - v.preco_compra - totalDesp + totalRec;
}

function mesAtual() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Mini-CRUD reutilizável (despesas e receitas) ─────────────────────────────

function ListaItens({
  itens,
  tabela,
  veiculoId,
  cor,
  onAlterado,
}: {
  itens: ItemFinanceiro[];
  tabela: "despesas_veiculo" | "receitas_veiculo";
  veiculoId: string;
  cor: "red" | "green";
  onAlterado: (itens: ItemFinanceiro[]) => void;
}) {
  const [desc, setDesc] = useState("");
  const [valor, setValor] = useState("");
  const [adding, setAdding] = useState(false);

  const total = itens.reduce((s, i) => s + i.valor, 0);
  const bg    = cor === "red" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600";

  async function adicionar(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!desc || !valor) return;
    setAdding(true);
    const { data } = await supabase
      .from(tabela)
      .insert({ veiculo_id: veiculoId, descricao: desc, valor: parseNum(valor) ?? 0 })
      .select()
      .single();
    if (data) onAlterado([...itens, data]);
    setDesc("");
    setValor("");
    setAdding(false);
  }

  async function remover(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await supabase.from(tabela).delete().eq("id", id);
    onAlterado(itens.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-2">
      {itens.length === 0 && (
        <p className="text-center text-[11px] text-gray-400 py-3">Nenhum item cadastrado</p>
      )}

      {itens.map((item) => (
        <div key={item.id} className="flex items-center justify-between py-2.5 px-4 bg-gray-50 rounded-2xl">
          <div>
            <p className="text-sm font-bold text-gray-800">{item.descricao}</p>
            <p className={`text-[10px] font-black ${cor === "red" ? "text-red-500" : "text-green-600"}`}>
              {fmt(item.valor)}
            </p>
          </div>
          <button
            onClick={(e) => remover(item.id, e)}
            className="p-1.5 hover:bg-red-50 rounded-xl transition-colors"
          >
            <Trash2 size={13} className="text-red-400" />
          </button>
        </div>
      ))}

      {itens.length > 0 && (
        <div className={`flex justify-between items-center px-4 py-3 rounded-2xl ${bg}`}>
          <p className="text-[10px] font-black uppercase tracking-widest">Total</p>
          <p className="font-black">{fmt(total)}</p>
        </div>
      )}

      {/* Adicionar novo item */}
      <div className="flex gap-2 pt-1">
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={cor === "red" ? "Ex: Revisão, IPVA..." : "Ex: Comissão financiamento..."}
          className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); } }}
        />
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="R$"
          type="number"
          className="w-24 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); } }}
        />
        <button
          type="button"
          onClick={adicionar}
          disabled={adding || !desc || !valor}
          className={`p-2.5 text-white rounded-xl transition-colors disabled:opacity-40 ${
            cor === "red" ? "bg-gray-900 hover:bg-red-600" : "bg-gray-900 hover:bg-green-600"
          }`}
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        </button>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({
  veiculo,
  vendedores,
  onClose,
  onReload,
}: {
  veiculo: Veiculo;
  vendedores: Vendedor[];
  onClose: () => void;
  onReload: () => void;
}) {
  const [aba, setAba] = useState<"aquisicao" | "despesas" | "receitas" | "venda">("aquisicao");
  const [saving, setSaving] = useState(false);

  // Aquisição
  const [precoCompra, setPrecoCompra] = useState(veiculo.preco_compra ? String(veiculo.preco_compra) : "");
  const [placa, setPlaca]             = useState(veiculo.placa ?? "");

  // Listas financeiras (estado local para não fechar modal ao alterar)
  const [despesas, setDespesas] = useState<ItemFinanceiro[]>(veiculo.despesas ?? []);
  const [receitas, setReceitas] = useState<ItemFinanceiro[]>(veiculo.receitas ?? []);

  // Venda
  const [precoVenda,  setPrecoVenda]  = useState(String(veiculo.preco_venda_final ?? veiculo.preco_sugerido ?? ""));
  const [dataVenda,   setDataVenda]   = useState(veiculo.data_venda ?? "");
  const [vendedorId,  setVendedorId]  = useState(veiculo.vendedor_id ?? "");

  // Comissão: pode ser % ou valor direto
  const [comissaoModo,  setComissaoModo]  = useState<"pct" | "valor">("pct");
  const [comissaoPct,   setComissaoPct]   = useState("");
  const [comissaoValDireto, setComissaoValDireto] = useState("");

  const vendedorSel = vendedores.find((v) => v.id === vendedorId);

  // Inicializa % com valor do vendedor quando seleciona
  useEffect(() => {
    if (vendedorSel && !comissaoPct) setComissaoPct(String(vendedorSel.comissao_pct));
  }, [vendedorSel]);

  const lucro = calcLucro(
    { ...veiculo, preco_compra: parseNum(precoCompra), preco_venda_final: parseNum(precoVenda) },
    despesas, receitas
  );

  const comissaoCalculada = (() => {
    if (!vendedorSel) return null;
    if (comissaoModo === "valor") return parseNum(comissaoValDireto);
    if (lucro == null) return null;
    return lucro * (parseNum(comissaoPct) ?? 0) / 100;
  })();

  async function salvarAquisicao(e: React.MouseEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase.from("veiculos").update({
      preco_compra: parseNum(precoCompra),
      placa: placa || null,
    }).eq("id", veiculo.id);
    setSaving(false);
    onReload();
  }

  async function salvarVenda(e: React.MouseEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase.from("veiculos").update({
      preco_venda_final: parseNum(precoVenda),
      data_venda: dataVenda || null,
      vendedor_id: vendedorId || null,
      status_venda: parseNum(precoVenda) ? "VENDIDO" : "DISPONIVEL",
    }).eq("id", veiculo.id);

    // Salva % no perfil do vendedor se modo pct
    if (vendedorId && comissaoModo === "pct" && comissaoPct) {
      await supabase.from("vendedores").update({ comissao_pct: parseNum(comissaoPct) }).eq("id", vendedorId);
    }
    setSaving(false);
    onReload();
    onClose();
  }

  const img = veiculo.capa_marketing_url ?? veiculo.fotos?.[0];
  const abas = [
    { key: "aquisicao", label: "Aquisição" },
    { key: "despesas",  label: "Despesas"  },
    { key: "receitas",  label: "Receitas"  },
    { key: "venda",     label: "Venda"     },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 p-6 border-b border-gray-100">
          <div className="w-16 h-12 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
            {img
              ? <img src={img} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-gray-200" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black uppercase italic tracking-tight text-gray-900 truncate">
              {veiculo.marca} {veiculo.modelo}
            </p>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              {veiculo.versao ?? "—"} • {veiculo.ano_modelo ?? "—"}
              {veiculo.placa && <> • <span className="text-gray-600 font-black">{veiculo.placa}</span></>}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        {/* Abas */}
        <div className="flex border-b border-gray-100">
          {abas.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setAba(a.key)}
              className={`flex-1 py-3 text-[9px] font-black uppercase tracking-widest transition-colors ${
                aba === a.key
                  ? "text-red-600 border-b-2 border-red-600"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Conteúdo */}
        <div className="p-6 max-h-[420px] overflow-y-auto">

          {/* ── Aquisição ── */}
          {aba === "aquisicao" && (
            <div className="space-y-4">
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5 block">
                  Preço de Compra
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">R$</span>
                  <input
                    type="number"
                    value={precoCompra}
                    onChange={(e) => setPrecoCompra(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-2xl text-gray-900 font-bold focus:outline-none focus:border-red-400"
                    placeholder="0,00"
                  />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5 block">
                  Placa
                </label>
                <input
                  type="text"
                  value={placa}
                  onChange={(e) => setPlaca(e.target.value.toUpperCase())}
                  maxLength={8}
                  className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-gray-900 font-bold focus:outline-none focus:border-red-400 uppercase tracking-widest"
                  placeholder="ABC-1234"
                />
              </div>
              <button
                type="button"
                onClick={salvarAquisicao}
                disabled={saving}
                className="w-full py-3 bg-gray-900 hover:bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Salvar Aquisição
              </button>
            </div>
          )}

          {/* ── Despesas ── */}
          {aba === "despesas" && (
            <ListaItens
              itens={despesas}
              tabela="despesas_veiculo"
              veiculoId={veiculo.id}
              cor="red"
              onAlterado={(itens) => { setDespesas(itens); onReload(); }}
            />
          )}

          {/* ── Receitas ── */}
          {aba === "receitas" && (
            <ListaItens
              itens={receitas}
              tabela="receitas_veiculo"
              veiculoId={veiculo.id}
              cor="green"
              onAlterado={(itens) => { setReceitas(itens); onReload(); }}
            />
          )}

          {/* ── Venda ── */}
          {aba === "venda" && (
            <div className="space-y-4">
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5 block">
                  Preço de Venda
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">R$</span>
                  <input
                    type="number"
                    value={precoVenda}
                    onChange={(e) => setPrecoVenda(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-2xl text-gray-900 font-bold focus:outline-none focus:border-red-400"
                    placeholder="0,00"
                  />
                </div>
              </div>

              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5 block">
                  Data da Venda
                </label>
                <input
                  type="date"
                  value={dataVenda}
                  onChange={(e) => setDataVenda(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-gray-900 font-bold focus:outline-none focus:border-red-400"
                />
              </div>

              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5 block">
                  Vendedor
                </label>
                <div className="relative">
                  <select
                    value={vendedorId}
                    onChange={(e) => setVendedorId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-gray-900 font-bold focus:outline-none focus:border-red-400 appearance-none bg-white"
                  >
                    <option value="">Sem vendedor</option>
                    {vendedores.map((v) => (
                      <option key={v.id} value={v.id}>{v.nome}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Bloco comissão */}
              {vendedorSel && (
                <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                    Comissão — {vendedorSel.nome}
                  </p>

                  {/* Toggle modo */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setComissaoModo("pct")}
                      className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                        comissaoModo === "pct" ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-400"
                      }`}
                    >
                      % do Lucro
                    </button>
                    <button
                      type="button"
                      onClick={() => setComissaoModo("valor")}
                      className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                        comissaoModo === "valor" ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-400"
                      }`}
                    >
                      Valor Fixo
                    </button>
                  </div>

                  {comissaoModo === "pct" ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={comissaoPct}
                        onChange={(e) => setComissaoPct(e.target.value)}
                        className="w-20 text-center px-3 py-2 border border-gray-200 rounded-xl text-sm font-black focus:outline-none focus:border-red-400"
                        step="0.5"
                        placeholder="3"
                      />
                      <span className="text-sm font-bold text-gray-500">% sobre o lucro</span>
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">R$</span>
                      <input
                        type="number"
                        value={comissaoValDireto}
                        onChange={(e) => setComissaoValDireto(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-gray-900 font-bold focus:outline-none focus:border-red-400"
                        placeholder="0,00"
                      />
                    </div>
                  )}

                  {/* Resumo */}
                  <div className="space-y-1.5 pt-1 border-t border-gray-200">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-500">Lucro bruto</span>
                      <span className={`font-black ${lucro != null ? (lucro >= 0 ? "text-green-600" : "text-red-500") : "text-gray-400"}`}>
                        {fmt(lucro)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="font-black text-gray-700">Comissão a pagar</span>
                      <span className="font-black text-gray-900">{fmt(comissaoCalculada)}</span>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={salvarVenda}
                disabled={saving || !precoVenda}
                className="w-full py-3 bg-green-500 hover:bg-green-400 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Registrar Venda
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal Comissões ──────────────────────────────────────────────────────────

function ModalComissoes({
  vendedores, veiculos, mes, onClose,
}: {
  vendedores: Vendedor[];
  veiculos: Veiculo[];
  mes: string;
  onClose: () => void;
}) {
  const vendidosMes = veiculos.filter(
    (v) => v.status_venda === "VENDIDO" && v.data_venda?.startsWith(mes)
  );

  const resumo = vendedores.map((vend) => {
    const vendas = vendidosMes.filter((v) => v.vendedor_id === vend.id);
    const totalLucro = vendas.reduce((s, v) => {
      const l = calcLucro(v, v.despesas ?? [], v.receitas ?? []);
      return s + (l ?? 0);
    }, 0);
    const comissao = (totalLucro * vend.comissao_pct) / 100;
    return { ...vend, vendas: vendas.length, totalLucro, comissao };
  }).filter((v) => v.vendas > 0 || true); // mostra todos mesmo sem venda no mês

  const totalComissoes = resumo.reduce((s, v) => s + v.comissao, 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <p className="font-black uppercase italic tracking-tight text-gray-900">Comissões do Mês</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
              {new Date(mes + "-01").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-3 max-h-96 overflow-y-auto">
          {resumo.map((v) => (
            <div key={v.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
              <div>
                <p className="font-black text-gray-900 text-sm">{v.nome}</p>
                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                  {v.vendas} venda{v.vendas !== 1 ? "s" : ""} • {v.comissao_pct}% do lucro
                </p>
                {v.vendas > 0 && (
                  <p className="text-[9px] text-gray-500 mt-0.5">
                    Lucro gerado: {fmt(v.totalLucro)}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className={`font-black text-lg tracking-tighter ${v.comissao > 0 ? "text-green-600" : "text-gray-300"}`}>
                  {fmt(v.comissao)}
                </p>
                {v.vendas === 0 && (
                  <p className="text-[9px] text-gray-300 font-bold">sem vendas</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Total a pagar</p>
          <p className="font-black text-xl tracking-tighter text-gray-900">{fmt(totalComissoes)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Financeiro Geral ───────────────────────────────────────────────────

function ModalFinanceiroGeral({
  itens, onAlterado, onClose,
}: {
  itens: ItemGeral[];
  onAlterado: (itens: ItemGeral[]) => void;
  onClose: () => void;
}) {
  const [desc,  setDesc]  = useState("");
  const [valor, setValor] = useState("");
  const [tipo,  setTipo]  = useState<"receita" | "despesa">("despesa");
  const [data,  setData]  = useState(new Date().toISOString().slice(0, 10));
  const [adding, setAdding] = useState(false);

  const receitas  = itens.filter((i) => i.tipo === "receita");
  const despesas  = itens.filter((i) => i.tipo === "despesa");
  const totRec    = receitas.reduce((s, i) => s + i.valor, 0);
  const totDesp   = despesas.reduce((s, i) => s + i.valor, 0);
  const saldo     = totRec - totDesp;

  async function adicionar(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!desc || !valor) return;
    setAdding(true);
    const { data: row } = await supabase
      .from("financeiro_geral")
      .insert({ tipo, descricao: desc, valor: parseNum(valor) ?? 0, data })
      .select().single();
    if (row) onAlterado([...itens, row]);
    setDesc(""); setValor("");
    setAdding(false);
  }

  async function remover(id: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    await supabase.from("financeiro_geral").delete().eq("id", id);
    onAlterado(itens.filter((i) => i.id !== id));
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <p className="font-black uppercase italic tracking-tight text-gray-900">Outras Receitas / Despesas</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">Itens não vinculados a veículos</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        {/* Lista */}
        <div className="p-6 space-y-2 max-h-72 overflow-y-auto">
          {itens.length === 0 && (
            <p className="text-center text-[11px] text-gray-400 py-4">Nenhum item cadastrado</p>
          )}
          {itens.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-2.5 px-4 bg-gray-50 rounded-2xl">
              <div>
                <p className="text-sm font-bold text-gray-800">{item.descricao}</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
                  {new Date(item.data + "T12:00:00").toLocaleDateString("pt-BR")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className={`font-black text-sm ${item.tipo === "receita" ? "text-green-600" : "text-red-500"}`}>
                  {item.tipo === "receita" ? "+" : "−"}{fmt(item.valor)}
                </p>
                <button onClick={(e) => remover(item.id, e)} className="p-1.5 hover:bg-red-50 rounded-xl transition-colors">
                  <Trash2 size={13} className="text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Adicionar */}
        <div className="px-6 pb-4 space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setTipo("despesa")}
              className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${tipo === "despesa" ? "bg-red-500 text-white" : "bg-gray-100 text-gray-400"}`}>
              Despesa
            </button>
            <button type="button" onClick={() => setTipo("receita")}
              className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${tipo === "receita" ? "bg-green-500 text-white" : "bg-gray-100 text-gray-400"}`}>
              Receita
            </button>
          </div>
          <div className="flex gap-2">
            <input value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder="Descrição (ex: Aluguel, Marketing...)"
              className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400"
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
            />
            <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$" type="number"
              className="w-24 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400"
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
            />
          </div>
          <div className="flex gap-2">
            <input type="date" value={data} onChange={(e) => setData(e.target.value)}
              className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400"
            />
            <button type="button" onClick={adicionar} disabled={adding || !desc || !valor}
              className="px-5 py-2.5 bg-gray-900 hover:bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-40 flex items-center gap-2">
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Adicionar
            </button>
          </div>
        </div>

        {/* Rodapé saldo */}
        <div className="grid grid-cols-3 border-t border-gray-100">
          <div className="px-5 py-3 text-center border-r border-gray-100">
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Receitas</p>
            <p className="font-black text-green-600 text-sm">{fmt(totRec)}</p>
          </div>
          <div className="px-5 py-3 text-center border-r border-gray-100">
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Despesas</p>
            <p className="font-black text-red-500 text-sm">{fmt(totDesp)}</p>
          </div>
          <div className="px-5 py-3 text-center">
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Saldo</p>
            <p className={`font-black text-sm ${saldo >= 0 ? "text-green-600" : "text-red-500"}`}>{fmt(saldo)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = "gray", icon: Icon, onClick }: {
  label: string; value: string; sub?: string;
  color?: "gray" | "green" | "red" | "blue" | "amber";
  icon: React.ElementType;
  onClick?: () => void;
}) {
  const bg  = { gray: "bg-white border-gray-100", green: "bg-green-50 border-green-100", red: "bg-red-50 border-red-100", blue: "bg-blue-50 border-blue-100", amber: "bg-amber-50 border-amber-100" };
  const ico = { gray: "text-gray-400", green: "text-green-500", red: "text-red-500", blue: "text-blue-500", amber: "text-amber-500" };
  return (
    <div
      className={`rounded-3xl border p-6 ${bg[color]} ${onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
        <Icon size={16} className={ico[color]} />
      </div>
      <p className="text-2xl font-black tracking-tighter text-gray-900">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
      {onClick && <p className="text-[8px] font-black uppercase tracking-widest text-gray-300 mt-2">clique para detalhes →</p>}
    </div>
  );
}

// ─── KPI Card Geral (com botão +) ────────────────────────────────────────────

function KpiCardGeral({ saldo, onAdd, onOpen }: {
  saldo: number; onAdd: () => void; onOpen: () => void;
}) {
  return (
    <div
      className="rounded-3xl border border-gray-100 bg-white p-6 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all relative"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Outras Rec. / Desp.</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            className="w-6 h-6 bg-gray-900 hover:bg-red-600 text-white rounded-lg flex items-center justify-center transition-colors"
          >
            <Plus size={12} />
          </button>
          <ReceiptText size={16} className="text-gray-400" />
        </div>
      </div>
      <p className={`text-2xl font-black tracking-tighter ${saldo >= 0 ? "text-gray-900" : "text-red-500"}`}>{fmt(saldo)}</p>
      <p className="text-[10px] text-gray-400 mt-1">saldo geral</p>
      <p className="text-[8px] font-black uppercase tracking-widest text-gray-300 mt-2">clique para detalhes →</p>
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function VendasPage() {
  const [veiculos,   setVeiculos]   = useState<Veiculo[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [selecionado, setSelecionado] = useState<Veiculo | null>(null);
  const [verComissoes,   setVerComissoes]   = useState(false);
  const [verGeral,       setVerGeral]       = useState(false);
  const [itensGeral,     setItensGeral]     = useState<ItemGeral[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [filtro,         setFiltro]         = useState<"todos" | "estoque" | "vendido">("todos");
  const [fechamentoDate, setFechamentoDate] = useState<string>("");

  const carregar = useCallback(async () => {
    const [{ data: veic }, { data: desp }, { data: rec }, { data: vend }, { data: geral }] = await Promise.all([
      supabase.from("veiculos").select("*").order("created_at", { ascending: false }),
      supabase.from("despesas_veiculo").select("*"),
      supabase.from("receitas_veiculo").select("*"),
      supabase.from("vendedores").select("id, nome, comissao_pct"),
      supabase.from("financeiro_geral").select("*").order("data", { ascending: false }),
    ]);

    const lista = (veic ?? []).map((v) => ({
      ...v,
      despesas: (desp ?? []).filter((d) => d.veiculo_id === v.id),
      receitas: (rec  ?? []).filter((r) => r.veiculo_id === v.id),
    }));

    setVeiculos(lista);
    setVendedores(vend ?? []);
    setItensGeral(geral ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Persistir fechamento no localStorage
  useEffect(() => {
    const saved = localStorage.getItem("garage_fechamento");
    if (saved) setFechamentoDate(saved);
  }, []);

  function salvarFechamento(date: string) {
    setFechamentoDate(date);
    localStorage.setItem("garage_fechamento", date);
  }

  const mes = mesAtual();

  const estoque      = veiculos.filter((v) => v.status_venda !== "VENDIDO");
  const vendidos     = veiculos.filter((v) => v.status_venda === "VENDIDO");
  const vendidosMes  = vendidos.filter((v) => v.data_venda?.startsWith(mes));

  const totalEstoqueCusto = estoque.reduce((s, v) => {
    const desp = (v.despesas ?? []).reduce((d, x) => d + x.valor, 0);
    return s + (v.preco_compra ?? 0) + desp;
  }, 0);

  const faturamentoMes = vendidosMes.reduce((s, v) => s + (v.preco_venda_final ?? 0), 0);

  const lucroVeiculosMes = vendidosMes.reduce((s, v) => {
    const l = calcLucro(v, v.despesas ?? [], v.receitas ?? []);
    return s + (l ?? 0);
  }, 0);

  const saldoGeralMes = itensGeral
    .filter((i) => i.data?.startsWith(mes))
    .reduce((s, i) => i.tipo === "receita" ? s + i.valor : s - i.valor, 0);

  const lucroMes = lucroVeiculosMes + saldoGeralMes;

  const despesasMes = veiculos.reduce((s, v) =>
    s + (v.despesas ?? []).reduce((d, x) => d + x.valor, 0), 0);

  const totalComissoesMes = vendedores.reduce((s, vend) => {
    const vendas = vendidosMes.filter((v) => v.vendedor_id === vend.id);
    const lucroVend = vendas.reduce((l, v) => l + (calcLucro(v, v.despesas ?? [], v.receitas ?? []) ?? 0), 0);
    return s + (lucroVend * vend.comissao_pct) / 100;
  }, 0);

  const saldoGeral = itensGeral.reduce((s, i) => i.tipo === "receita" ? s + i.valor : s - i.valor, 0);

  // ── Histórico mensal ──────────────────────────────────────────────────────
  // Coleta todos os meses únicos com dados de vendas ou financeiro_geral
  const mesesComDados = Array.from(new Set([
    ...vendidos.filter((v) => v.data_venda).map((v) => v.data_venda!.slice(0, 7)),
    ...itensGeral.filter((i) => i.data).map((i) => i.data.slice(0, 7)),
  ])).sort((a, b) => b.localeCompare(a)); // mais recente primeiro

  function calcLucroMes(m: string) {
    const veicsM = vendidos.filter((v) => v.data_venda?.startsWith(m));
    const lucroV = veicsM.reduce((s, v) => s + (calcLucro(v, v.despesas ?? [], v.receitas ?? []) ?? 0), 0);
    const saldoG = itensGeral.filter((i) => i.data?.startsWith(m))
      .reduce((s, i) => i.tipo === "receita" ? s + i.valor : s - i.valor, 0);
    return lucroV + saldoG;
  }

  // ── Acumulado anual ───────────────────────────────────────────────────────
  const anoAtual = new Date().getFullYear().toString();
  const lucroAnual = mesesComDados
    .filter((m) => m.startsWith(anoAtual))
    .reduce((s, m) => s + calcLucroMes(m), 0);

  const filtrados = filtro === "todos" ? veiculos : filtro === "estoque" ? estoque : vendidos;

  return (
    <div className="p-8 bg-[#f4f4f2] min-h-screen font-sans">
      <div className="max-w-6xl mx-auto">

        <div className="mb-10">
          <h1 className="text-5xl font-black italic uppercase text-gray-900 leading-none tracking-tighter">Financeiro</h1>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400 mt-1">Vendas • Despesas • Receitas • Comissões</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          <KpiCard label="Estoque em Custo"    value={fmt(totalEstoqueCusto)} sub={`${estoque.length} veículos`}   icon={Package}      color="blue"  />
          <KpiCard label="Faturamento do Mês"  value={fmt(faturamentoMes)}   sub={`${vendidosMes.length} vendas`} icon={DollarSign}   color="green" />
          <KpiCard label="Lucro Bruto do Mês"  value={fmt(lucroMes)}         sub="veículos + outras rec/desp"     icon={TrendingUp}   color={lucroMes >= 0 ? "green" : "red"} />
          <KpiCard label="Despesas do Mês"     value={fmt(despesasMes)}      sub="todos os veículos"              icon={TrendingDown} color="red"   />
          <KpiCard
            label="Comissões a Pagar"
            value={fmt(totalComissoesMes)}
            sub={`${vendedores.length} vendedor${vendedores.length !== 1 ? "es" : ""}`}
            icon={Users}
            color="amber"
            onClick={() => setVerComissoes(true)}
          />
          <KpiCardGeral
            saldo={saldoGeral}
            onAdd={() => setVerGeral(true)}
            onOpen={() => setVerGeral(true)}
          />
        </div>

        {/* Histórico + Acumulado */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-10">

          {/* Card Fechamento + Histórico Mensal */}
          <div className="lg:col-span-2 bg-white rounded-3xl border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Histórico Mensal</p>
                <p className="text-[9px] text-gray-300 mt-0.5">Lucro por período fechado</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Próx. fechamento</p>
                <input
                  type="date"
                  value={fechamentoDate}
                  onChange={(e) => salvarFechamento(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-xl text-[11px] font-bold text-gray-700 focus:outline-none focus:border-red-400"
                />
              </div>
            </div>

            {mesesComDados.length === 0 ? (
              <p className="text-center text-[11px] text-gray-300 py-6">Nenhum dado histórico ainda</p>
            ) : (
              <div className="space-y-2">
                {mesesComDados.map((m) => {
                  const lucro = calcLucroMes(m);
                  const [ano, mesNum] = m.split("-");
                  const label = new Date(parseInt(ano), parseInt(mesNum) - 1, 1)
                    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
                  const ehAtual = m === mes;
                  const fechado = fechamentoDate && m < mes;
                  return (
                    <div key={m} className={`flex items-center justify-between px-4 py-3 rounded-2xl ${ehAtual ? "bg-blue-50 border border-blue-100" : "bg-gray-50"}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${ehAtual ? "bg-blue-400" : fechado ? "bg-gray-300" : "bg-gray-200"}`} />
                        <div>
                          <p className="text-sm font-black text-gray-800 capitalize">{label}</p>
                          {ehAtual && <p className="text-[8px] font-bold uppercase tracking-widest text-blue-400">período atual</p>}
                          {fechado && <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400">fechado</p>}
                        </div>
                      </div>
                      <p className={`font-black text-base tracking-tighter ${lucro >= 0 ? "text-green-600" : "text-red-500"}`}>
                        {fmt(lucro)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card Acumulado Anual */}
          <div className="bg-white rounded-3xl border border-gray-100 p-6 flex flex-col justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Acumulado Anual</p>
              <p className="text-[9px] text-gray-300">{anoAtual}</p>
            </div>
            <div>
              <p className={`text-4xl font-black tracking-tighter mt-6 ${lucroAnual >= 0 ? "text-gray-900" : "text-red-500"}`}>
                {fmt(lucroAnual)}
              </p>
              <p className="text-[10px] text-gray-400 mt-2">
                {mesesComDados.filter((m) => m.startsWith(anoAtual)).length} mês(es) com dados
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-gray-100">
              <p className="text-[8px] font-black uppercase tracking-widest text-gray-300">
                Todos os veículos + receitas e despesas gerais
              </p>
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-2 mb-6">
          {(["todos", "estoque", "vendido"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                filtro === f ? "bg-gray-900 text-white" : "bg-white text-gray-400 hover:text-gray-700 border border-gray-100"
              }`}
            >
              {f === "todos" ? "Todos" : f === "estoque" ? "Em Estoque" : "Vendidos"}
            </button>
          ))}
        </div>

        {/* Lista */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
        ) : (
          <div className="grid gap-3">
            {filtrados.map((v) => {
              const img      = v.capa_marketing_url ?? v.fotos?.[0];
              const despTotal = (v.despesas ?? []).reduce((s, d) => s + d.valor, 0);
              const recTotal  = (v.receitas ?? []).reduce((s, r) => s + r.valor, 0);
              const lucro     = calcLucro(v, v.despesas ?? [], v.receitas ?? []);
              const vendido   = v.status_venda === "VENDIDO";

              return (
                <button
                  key={v.id}
                  onClick={() => setSelecionado(v)}
                  className="bg-white rounded-[2rem] border border-gray-100 p-4 flex items-center gap-4 hover:shadow-lg hover:border-red-200 transition-all text-left w-full group"
                >
                  <div className="w-20 h-14 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    {img
                      ? <img src={img} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      : <div className="w-full h-full bg-gray-200" />
                    }
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-black uppercase italic text-gray-900 tracking-tight truncate">
                        {v.marca} {v.modelo}
                      </p>
                      <span className={`flex-shrink-0 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        vendido ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                      }`}>
                        {vendido ? "Vendido" : "Estoque"}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                      {v.versao ?? "—"} • {v.ano_modelo ?? "—"}
                      {v.placa && <> • <span className="text-gray-600 font-black">{v.placa}</span></>}
                    </p>
                  </div>

                  <div className="flex gap-5 flex-shrink-0 text-right">
                    {v.preco_compra && (
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Compra</p>
                        <p className="font-black text-sm text-gray-700">{fmt(v.preco_compra)}</p>
                      </div>
                    )}
                    {despTotal > 0 && (
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Despesas</p>
                        <p className="font-black text-sm text-red-500">{fmt(despTotal)}</p>
                      </div>
                    )}
                    {recTotal > 0 && (
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Receitas</p>
                        <p className="font-black text-sm text-green-600">{fmt(recTotal)}</p>
                      </div>
                    )}
                    {vendido && v.preco_venda_final && (
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Venda</p>
                        <p className="font-black text-sm text-green-600">{fmt(v.preco_venda_final)}</p>
                      </div>
                    )}
                    {lucro != null && (
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Lucro</p>
                        <p className={`font-black text-sm ${lucro >= 0 ? "text-green-600" : "text-red-500"}`}>{fmt(lucro)}</p>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selecionado && (
        <Modal
          veiculo={selecionado}
          vendedores={vendedores}
          onClose={() => setSelecionado(null)}
          onReload={carregar}
        />
      )}

      {verComissoes && (
        <ModalComissoes
          vendedores={vendedores}
          veiculos={veiculos}
          mes={mes}
          onClose={() => setVerComissoes(false)}
        />
      )}

      {verGeral && (
        <ModalFinanceiroGeral
          itens={itensGeral}
          onAlterado={setItensGeral}
          onClose={() => setVerGeral(false)}
        />
      )}
    </div>
  );
}
