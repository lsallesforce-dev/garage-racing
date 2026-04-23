"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  X, Plus, Trash2, DollarSign, TrendingUp, TrendingDown,
  Package, ChevronDown, Check, Loader2, Users, ReceiptText,
  ArrowUpRight, ArrowDownRight, Car, Contact, FileSignature,
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

function fmtCompact(v: number) {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return fmt(v);
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

function labelMes(m: string) {
  const [ano, mesNum] = m.split("-");
  return new Date(parseInt(ano), parseInt(mesNum) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(".", "");
}

// ─── Mini-CRUD reutilizável (despesas e receitas) ─────────────────────────────

function ListaItens({
  itens, tabela, veiculoId, cor, onAlterado,
}: {
  itens: ItemFinanceiro[];
  tabela: "despesas_veiculo" | "receitas_veiculo";
  veiculoId: string;
  cor: "red" | "green";
  onAlterado: (itens: ItemFinanceiro[]) => void;
}) {
  const [desc, setDesc]   = useState("");
  const [valor, setValor] = useState("");
  const [adding, setAdding] = useState(false);

  const total = itens.reduce((s, i) => s + i.valor, 0);
  const bg    = cor === "red" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600";

  async function adicionar(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!desc || !valor) return;
    setAdding(true);
    const res = await fetch("/api/financeiro/veiculo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabela, veiculo_id: veiculoId, descricao: desc, valor: parseNum(valor) ?? 0 }),
    });
    const data = res.ok ? await res.json() : null;
    if (data) onAlterado([...itens, data]);
    setDesc(""); setValor("");
    setAdding(false);
  }

  async function remover(id: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    await fetch("/api/financeiro/veiculo", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabela, id }),
    });
    onAlterado(itens.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-2">
      {itens.length === 0 && (
        <p className="text-center text-xs text-gray-400 py-6">Nenhum item cadastrado</p>
      )}
      {itens.map((item) => (
        <div key={item.id} className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-2xl">
          <div>
            <p className="text-sm font-bold text-gray-800">{item.descricao}</p>
            <p className={`text-xs font-black mt-0.5 ${cor === "red" ? "text-red-500" : "text-green-600"}`}>
              {fmt(item.valor)}
            </p>
          </div>
          <button onClick={(e) => remover(item.id, e)} className="p-2 hover:bg-red-50 rounded-xl transition-colors">
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

      <div className="flex gap-2 pt-2">
        <input value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder={cor === "red" ? "Ex: Revisão, IPVA..." : "Ex: Comissão financiamento..."}
          className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400"
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
        />
        <input value={valor} onChange={(e) => setValor(e.target.value)}
          placeholder="R$" type="number"
          className="w-24 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400"
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
        />
        <button type="button" onClick={adicionar} disabled={adding || !desc || !valor}
          className={`p-2.5 text-white rounded-xl transition-colors disabled:opacity-40 ${
            cor === "red" ? "bg-gray-900 hover:bg-red-600" : "bg-gray-900 hover:bg-green-600"
          }`}>
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        </button>
      </div>
    </div>
  );
}

// ─── SlideOver (detalhe do veículo) ───────────────────────────────────────────

function SlideOver({
  veiculo, vendedores, onClose, onReload,
}: {
  veiculo: Veiculo;
  vendedores: Vendedor[];
  onClose: () => void;
  onReload: () => void;
}) {
  const [aba, setAba]     = useState<"aquisicao" | "despesas" | "receitas" | "venda">("aquisicao");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const [precoCompra, setPrecoCompra] = useState(veiculo.preco_compra ? String(veiculo.preco_compra) : "");
  const [placa, setPlaca]             = useState(veiculo.placa ?? "");

  const [despesas, setDespesas] = useState<ItemFinanceiro[]>(veiculo.despesas ?? []);
  const [receitas, setReceitas] = useState<ItemFinanceiro[]>(veiculo.receitas ?? []);

  const [precoVenda,  setPrecoVenda]  = useState(String(veiculo.preco_venda_final ?? veiculo.preco_sugerido ?? ""));
  const [dataVenda,   setDataVenda]   = useState(veiculo.data_venda ?? "");
  const [vendedorId,  setVendedorId]  = useState(veiculo.vendedor_id ?? "");
  const [comissaoModo, setComissaoModo] = useState<"pct" | "valor">("pct");
  const [comissaoPct,  setComissaoPct]  = useState("");
  const [comissaoValDireto, setComissaoValDireto] = useState("");

  const vendedorSel = vendedores.find((v) => v.id === vendedorId);

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

  const margem = (() => {
    const compra = parseNum(precoCompra);
    const venda  = parseNum(precoVenda);
    if (!compra || !venda) return null;
    return ((venda - compra) / compra) * 100;
  })();

  async function salvarAquisicao(e: React.MouseEvent) {
    e.preventDefault(); setSaving(true);
    await fetch("/api/veiculo/patch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ veiculoId: veiculo.id, fields: { preco_compra: parseNum(precoCompra), placa: placa || null } }),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onReload();
  }

  async function salvarVendaEGerarContrato(e: React.MouseEvent) {
    e.preventDefault(); setSaving(true);

    await fetch("/api/veiculo/patch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        veiculoId: veiculo.id,
        fields: {
          preco_venda_final: parseNum(precoVenda),
          data_venda: dataVenda || null,
          vendedor_id: vendedorId || null,
          status_venda: parseNum(precoVenda) ? "VENDIDO" : "DISPONIVEL",
        },
      }),
    });

    if (vendedorId && comissaoModo === "pct" && comissaoPct) {
      await fetch("/api/financeiro/vendedor-comissao", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendedorId, comissao_pct: parseNum(comissaoPct) }),
      });
    }

    // Cria contrato pré-preenchido e abre página de impressão
    try {
      const [dadosVendRes] = await Promise.all([
        fetch("/api/contratos/dados-vendedor"),
      ]);
      const loja = dadosVendRes.ok ? await dadosVendRes.json() : {};

      const nomeVeic = [veiculo.marca, veiculo.modelo, veiculo.versao].filter(Boolean).join(" ");
      const contratoRes = await fetch("/api/contratos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          veiculo_id: veiculo.id,
          dados: {
            vendedor: {
              nome: loja.nome_fantasia || loja.nome_empresa || "",
              cnpj: loja.cnpj || "",
              endereco: loja.endereco || "",
              cidade: loja.cidade || "",
              estado: loja.estado || "",
            },
            comprador: { nome: "", cpf: "", rg: "", endereco: "", cidade: "", estado: "" },
            veiculo: {
              descricao: nomeVeic,
              ano: veiculo.ano_modelo || "",
              placa: veiculo.placa || "",
              renavam: "",
              chassi: "",
              cor: "",
            },
            pagamento: {
              valor: parseNum(precoVenda) || 0,
              forma: "dinheiro",
              parcelas: null,
              entrada: null,
              obs: "",
            },
            data_contrato: dataVenda || new Date().toISOString().split("T")[0],
          },
        }),
      });

      if (contratoRes.ok) {
        const contrato = await contratoRes.json();
        window.open(`/contratos/${contrato.id}/imprimir`, "_blank");
      }
    } catch (_) {
      // contrato falhou — venda já foi salva
    }

    setSaving(false); onReload(); onClose();
  }

  const img     = veiculo.capa_marketing_url ?? veiculo.fotos?.[0];
  const vendido = veiculo.status_venda === "VENDIDO";
  const abas    = [
    { key: "aquisicao", label: "Aquisição" },
    { key: "despesas",  label: "Despesas"  },
    { key: "receitas",  label: "Receitas"  },
    { key: "venda",     label: "Venda"     },
  ] as const;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      {/* Painel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[480px] bg-white shadow-2xl flex flex-col" style={{ animation: "slideInRight 0.25s ease-out" }}>

        {/* Header — foto + nome + números rápidos */}
        <div className="relative flex-shrink-0">
          {img ? (
            <div className="h-44 w-full overflow-hidden">
              <img src={img} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            </div>
          ) : (
            <div className="h-44 bg-gray-900 flex items-center justify-center">
              <Car size={48} className="text-gray-700" />
            </div>
          )}

          <button onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 bg-black/40 hover:bg-black/60 backdrop-blur rounded-full flex items-center justify-center transition-colors">
            <X size={14} className="text-white" />
          </button>

          <span className={`absolute top-4 left-4 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${
            vendido ? "bg-green-500 text-white" : "bg-blue-500 text-white"
          }`}>
            {vendido ? "Vendido" : "Estoque"}
          </span>

          {/* Overlay de info no rodapé da foto */}
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
            <p className="text-white font-black text-xl uppercase italic tracking-tight leading-tight drop-shadow-md">
              {veiculo.marca} {veiculo.modelo}
            </p>
            <p className="text-white/70 text-xs font-bold uppercase tracking-wider">
              {veiculo.versao ?? "—"} · {veiculo.ano_modelo ?? "—"}
              {veiculo.placa && <> · <span className="text-white font-black">{veiculo.placa}</span></>}
            </p>
          </div>
        </div>

        {/* Mini KPIs */}
        <div className="grid grid-cols-3 border-b border-gray-100 flex-shrink-0">
          {[
            { label: "Compra",   value: fmt(parseNum(precoCompra)), color: "text-gray-900" },
            { label: "Despesas", value: fmt(despesas.reduce((s,d)=>s+d.valor,0) || null), color: "text-red-500" },
            { label: lucro != null ? "Lucro" : "Venda",
              value: lucro != null ? fmt(lucro) : fmt(parseNum(precoVenda)),
              color: lucro != null ? (lucro >= 0 ? "text-green-600" : "text-red-500") : "text-gray-900" },
          ].map((k) => (
            <div key={k.label} className="px-4 py-3 text-center border-r last:border-r-0 border-gray-100">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">{k.label}</p>
              <p className={`text-sm font-black ${k.color}`}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* Abas */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          {abas.map((a) => (
            <button key={a.key} type="button" onClick={() => setAba(a.key)}
              className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-colors ${
                aba === a.key ? "text-red-600 border-b-2 border-red-600" : "text-gray-400 hover:text-gray-700"
              }`}>
              {a.label}
            </button>
          ))}
        </div>

        {/* Conteúdo da aba */}
        <div className="flex-1 overflow-y-auto p-6">

          {aba === "aquisicao" && (
            <div className="space-y-5">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">Preço de Compra</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">R$</span>
                  <input type="number" value={precoCompra} onChange={(e) => setPrecoCompra(e.target.value)}
                    className="w-full pl-10 pr-4 py-4 border border-gray-200 rounded-2xl text-gray-900 font-bold text-lg focus:outline-none focus:border-red-400"
                    placeholder="0" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">Placa</label>
                <input type="text" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())}
                  maxLength={8}
                  className="w-full px-4 py-4 border border-gray-200 rounded-2xl text-gray-900 font-bold text-lg uppercase tracking-widest focus:outline-none focus:border-red-400"
                  placeholder="ABC-1234" />
              </div>
              <button type="button" onClick={salvarAquisicao} disabled={saving}
                className={`w-full py-4 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                  saved ? "bg-green-500" : "bg-gray-900 hover:bg-red-600"
                }`}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {saved ? "Salvo!" : "Salvar Aquisição"}
              </button>
            </div>
          )}

          {aba === "despesas" && (
            <ListaItens itens={despesas} tabela="despesas_veiculo" veiculoId={veiculo.id}
              cor="red" onAlterado={setDespesas} />
          )}

          {aba === "receitas" && (
            <ListaItens itens={receitas} tabela="receitas_veiculo" veiculoId={veiculo.id}
              cor="green" onAlterado={setReceitas} />
          )}

          {(aba === "despesas" || aba === "receitas") && (
            <button
              type="button"
              onClick={() => { onReload(); setSaved(true); setTimeout(() => setSaved(false), 2000); }}
              className={`mt-6 w-full py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                saved ? "bg-green-500 text-white" : "bg-gray-900 hover:bg-red-600 text-white"
              }`}
            >
              <Check size={15} />
              {saved ? "Alterações salvas!" : "Salvar Alterações"}
            </button>
          )}

          {aba === "venda" && (
            <div className="space-y-5">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">Preço de Venda</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">R$</span>
                  <input type="number" value={precoVenda} onChange={(e) => setPrecoVenda(e.target.value)}
                    className="w-full pl-10 pr-4 py-4 border border-gray-200 rounded-2xl text-gray-900 font-bold text-lg focus:outline-none focus:border-red-400"
                    placeholder="0" />
                </div>
                {margem != null && (
                  <p className={`text-xs font-bold mt-1.5 ${margem >= 0 ? "text-green-600" : "text-red-500"}`}>
                    Margem bruta {margem > 0 ? "+" : ""}{margem.toFixed(1)}% sobre o custo
                  </p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">Data da Venda</label>
                <input type="date" value={dataVenda} onChange={(e) => setDataVenda(e.target.value)}
                  className="w-full px-4 py-4 border border-gray-200 rounded-2xl text-gray-900 font-bold focus:outline-none focus:border-red-400" />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">Vendedor</label>
                <div className="relative">
                  <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}
                    className="w-full px-4 py-4 border border-gray-200 rounded-2xl text-gray-900 font-bold focus:outline-none focus:border-red-400 appearance-none bg-white">
                    <option value="">Sem vendedor</option>
                    {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {vendedorSel && (
                <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Comissão — {vendedorSel.nome}</p>
                  <div className="flex gap-2">
                    {(["pct", "valor"] as const).map((m) => (
                      <button key={m} type="button" onClick={() => setComissaoModo(m)}
                        className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                          comissaoModo === m ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-400"
                        }`}>
                        {m === "pct" ? "% do Lucro" : "Valor Fixo"}
                      </button>
                    ))}
                  </div>
                  {comissaoModo === "pct" ? (
                    <div className="flex items-center gap-2">
                      <input type="number" value={comissaoPct} onChange={(e) => setComissaoPct(e.target.value)}
                        className="w-20 text-center px-3 py-2 border border-gray-200 rounded-xl text-sm font-black focus:outline-none focus:border-red-400"
                        step="0.5" placeholder="3" />
                      <span className="text-sm font-bold text-gray-500">% sobre o lucro</span>
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">R$</span>
                      <input type="number" value={comissaoValDireto} onChange={(e) => setComissaoValDireto(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-gray-900 font-bold focus:outline-none focus:border-red-400"
                        placeholder="0,00" />
                    </div>
                  )}
                  <div className="space-y-1.5 pt-1 border-t border-gray-200">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Lucro bruto</span>
                      <span className={`font-black ${lucro != null ? (lucro >= 0 ? "text-green-600" : "text-red-500") : "text-gray-400"}`}>
                        {fmt(lucro)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="font-black text-gray-700">Comissão a pagar</span>
                      <span className="font-black text-gray-900">{fmt(comissaoCalculada)}</span>
                    </div>
                  </div>
                </div>
              )}

              <button type="button" onClick={salvarVendaEGerarContrato} disabled={saving || !precoVenda}
                className="w-full py-4 bg-green-500 hover:bg-green-400 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-40">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <FileSignature size={15} />}
                Salvar Venda e Gerar Contrato
              </button>
            </div>
          )}
        </div>
      </div>
    </>
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
  const vendidosMes = veiculos.filter((v) => v.status_venda === "VENDIDO" && v.data_venda?.startsWith(mes));

  const resumo = vendedores.map((vend) => {
    const vendas = vendidosMes.filter((v) => v.vendedor_id === vend.id);
    const totalLucro = vendas.reduce((s, v) => s + (calcLucro(v, v.despesas ?? [], v.receitas ?? []) ?? 0), 0);
    const comissao = (totalLucro * vend.comissao_pct) / 100;
    return { ...vend, vendas: vendas.length, totalLucro, comissao };
  });

  const totalComissoes = resumo.reduce((s, v) => s + v.comissao, 0);
  const [pagamentos, setPagamentos] = useState<Record<string, { id: string; data: string }>>({});
  const [datas, setDatas]           = useState<Record<string, string>>({});
  const [salvando, setSalvando]     = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function carregarPagamentos() {
      const res = await fetch(`/api/financeiro/resumo`);
      if (!res.ok) return;
      const { geral } = await res.json();
      const map: Record<string, { id: string; data: string }> = {};
      (geral as { id: string; descricao: string; data: string }[])
        .filter((i) => i.descricao?.startsWith(`COMISSAO:`) && i.descricao?.endsWith(`:${mes}`))
        .forEach((item) => {
          const parts = item.descricao.split(":");
          if (parts.length === 3) map[parts[1]] = { id: item.id, data: item.data };
        });
      setPagamentos(map);
    }
    carregarPagamentos();
  }, [mes]);

  async function registrarPagamento(vendId: string, valor: number) {
    const data = datas[vendId] || new Date().toISOString().split("T")[0];
    setSalvando((p) => ({ ...p, [vendId]: true }));
    const res = await fetch("/api/financeiro/geral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "despesa", descricao: `COMISSAO:${vendId}:${mes}`, valor, data }),
    });
    const inserted = res.ok ? await res.json() : null;
    if (inserted) setPagamentos((p) => ({ ...p, [vendId]: { id: inserted.id, data: inserted.data } }));
    setSalvando((p) => ({ ...p, [vendId]: false }));
  }

  async function desfazerPagamento(vendId: string) {
    const pag = pagamentos[vendId];
    if (!pag) return;
    await fetch("/api/financeiro/geral", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: pag.id }) });
    setPagamentos((p) => { const n = { ...p }; delete n[vendId]; return n; });
  }

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
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors"><X size={16} className="text-gray-400" /></button>
        </div>
        <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
          {resumo.map((v) => {
            const pago = pagamentos[v.id];
            return (
              <div key={v.id} className={`p-4 rounded-2xl border ${pago ? "bg-green-50 border-green-100" : "bg-gray-50 border-transparent"}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-black text-gray-900 text-sm">{v.nome}</p>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                      {v.vendas} venda{v.vendas !== 1 ? "s" : ""} · {v.comissao_pct}% do lucro
                    </p>
                    {v.vendas > 0 && <p className="text-[9px] text-gray-500 mt-0.5">Lucro gerado: {fmt(v.totalLucro)}</p>}
                  </div>
                  <div className="text-right">
                    <p className={`font-black text-lg tracking-tighter ${v.comissao > 0 ? "text-green-600" : "text-gray-300"}`}>{fmt(v.comissao)}</p>
                    {v.vendas === 0 && <p className="text-[9px] text-gray-300 font-bold">sem vendas</p>}
                  </div>
                </div>
                {v.comissao > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200/60">
                    {pago ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center"><Check size={11} className="text-white" /></span>
                          <span className="text-[10px] font-black text-green-700 uppercase tracking-widest">
                            Pago em {new Date(pago.data + "T12:00:00").toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                        <button onClick={() => desfazerPagamento(v.id)} className="text-[9px] text-gray-400 hover:text-red-500 font-bold underline">Desfazer</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input type="date" value={datas[v.id] || new Date().toISOString().split("T")[0]}
                          onChange={(e) => setDatas((p) => ({ ...p, [v.id]: e.target.value }))}
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-[11px] text-gray-700 focus:outline-none focus:border-green-400" />
                        <button onClick={() => registrarPagamento(v.id, v.comissao)} disabled={salvando[v.id]}
                          className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-green-600 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors whitespace-nowrap">
                          {salvando[v.id] ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          Registrar Baixa
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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

function ModalFinanceiroGeral({ itens, onAlterado, onClose }: {
  itens: ItemGeral[]; onAlterado: (itens: ItemGeral[]) => void; onClose: () => void;
}) {
  const [desc,  setDesc]  = useState("");
  const [valor, setValor] = useState("");
  const [tipo,  setTipo]  = useState<"receita" | "despesa">("despesa");
  const [data,  setData]  = useState(new Date().toISOString().slice(0, 10));
  const [adding, setAdding] = useState(false);

  const totRec  = itens.filter((i) => i.tipo === "receita").reduce((s, i) => s + i.valor, 0);
  const totDesp = itens.filter((i) => i.tipo === "despesa").reduce((s, i) => s + i.valor, 0);
  const saldo   = totRec - totDesp;

  async function adicionar(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!desc || !valor) return;
    setAdding(true);
    const res = await fetch("/api/financeiro/geral", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, descricao: desc, valor: parseNum(valor) ?? 0, data }),
    });
    const row = res.ok ? await res.json() : null;
    if (row) onAlterado([...itens, row]);
    setDesc(""); setValor(""); setAdding(false);
  }

  async function remover(id: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    await fetch("/api/financeiro/geral", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    onAlterado(itens.filter((i) => i.id !== id));
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <p className="font-black uppercase italic tracking-tight text-gray-900">Outras Receitas / Despesas</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">Itens não vinculados a veículos</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl"><X size={16} className="text-gray-400" /></button>
        </div>
        <div className="p-6 space-y-2 max-h-64 overflow-y-auto">
          {itens.length === 0 && <p className="text-center text-xs text-gray-400 py-4">Nenhum item cadastrado</p>}
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
                <button onClick={(e) => remover(item.id, e)} className="p-1.5 hover:bg-red-50 rounded-xl">
                  <Trash2 size={13} className="text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 pb-4 space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setTipo("despesa")}
              className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${tipo === "despesa" ? "bg-red-500 text-white" : "bg-gray-100 text-gray-400"}`}>Despesa</button>
            <button type="button" onClick={() => setTipo("receita")}
              className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${tipo === "receita" ? "bg-green-500 text-white" : "bg-gray-100 text-gray-400"}`}>Receita</button>
          </div>
          <div className="flex gap-2">
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição"
              className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400"
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
            <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$" type="number"
              className="w-24 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400"
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
          </div>
          <div className="flex gap-2">
            <input type="date" value={data} onChange={(e) => setData(e.target.value)}
              className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-gray-400" />
            <button type="button" onClick={adicionar} disabled={adding || !desc || !valor}
              className="px-5 py-2.5 bg-gray-900 hover:bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-40 flex items-center gap-2">
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Adicionar
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 border-t border-gray-100">
          {[
            { label: "Receitas",  value: fmt(totRec),  color: "text-green-600" },
            { label: "Despesas",  value: fmt(totDesp), color: "text-red-500"   },
            { label: "Saldo",     value: fmt(saldo),   color: saldo >= 0 ? "text-green-600" : "text-red-500" },
          ].map((k, i) => (
            <div key={k.label} className={`px-5 py-3 text-center ${i < 2 ? "border-r border-gray-100" : ""}`}>
              <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">{k.label}</p>
              <p className={`font-black text-sm ${k.color}`}>{k.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function VendasPage() {
  const [veiculos,   setVeiculos]   = useState<Veiculo[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [selecionado, setSelecionado] = useState<Veiculo | null>(null);
  const [verComissoes, setVerComissoes] = useState(false);
  const [verGeral,     setVerGeral]     = useState(false);
  const [itensGeral,   setItensGeral]   = useState<ItemGeral[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [filtro,       setFiltro]       = useState<"todos" | "estoque" | "vendido">("todos");
  const [fechamentoDate, setFechamentoDate] = useState("");

  const carregar = useCallback(async () => {
    const res = await fetch("/api/financeiro/resumo");
    if (!res.ok) return;
    const { veiculos: lista, vendedores: vend, geral } = await res.json();

    setVeiculos(lista);
    setVendedores(vend);
    setItensGeral(geral);
    setLoading(false);
    setSelecionado((prev) => prev ? lista.find((v: { id: string }) => v.id === prev.id) ?? null : null);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    const saved = localStorage.getItem("garage_fechamento");
    if (saved) setFechamentoDate(saved);
  }, []);

  function salvarFechamento(date: string) {
    setFechamentoDate(date);
    localStorage.setItem("garage_fechamento", date);
  }

  const mes = mesAtual();
  const mesLabel = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const estoque     = veiculos.filter((v) => v.status_venda !== "VENDIDO");
  const vendidos    = veiculos.filter((v) => v.status_venda === "VENDIDO");
  const vendidosMes = vendidos.filter((v) => v.data_venda?.startsWith(mes));

  const faturamentoMes    = vendidosMes.reduce((s, v) => s + (v.preco_venda_final ?? 0), 0);
  const lucroVeiculosMes  = vendidosMes.reduce((s, v) => s + (calcLucro(v, v.despesas ?? [], v.receitas ?? []) ?? 0), 0);
  const saldoGeralMes     = itensGeral.filter((i) => i.data?.startsWith(mes)).reduce((s, i) => i.tipo === "receita" ? s + i.valor : s - i.valor, 0);
  const lucroMes          = lucroVeiculosMes + saldoGeralMes;
  const totalEstoqueCusto = estoque.reduce((s, v) => s + (v.preco_compra ?? 0) + (v.despesas ?? []).reduce((d, x) => d + x.valor, 0), 0);
  const despesasMes       = [...estoque, ...vendidosMes].reduce((s, v) => s + (v.despesas ?? []).reduce((d, x) => d + x.valor, 0), 0);
  const totalComissoesMes = vendedores.reduce((s, vend) => {
    const vendas = vendidosMes.filter((v) => v.vendedor_id === vend.id);
    const lucroVend = vendas.reduce((l, v) => l + (calcLucro(v, v.despesas ?? [], v.receitas ?? []) ?? 0), 0);
    return s + (lucroVend * vend.comissao_pct) / 100;
  }, 0);
  const saldoGeral = itensGeral.reduce((s, i) => i.tipo === "receita" ? s + i.valor : s - i.valor, 0);
  const margemMedia = faturamentoMes > 0 ? (lucroVeiculosMes / faturamentoMes) * 100 : null;

  // Histórico mensal
  const mesesComDados = Array.from(new Set([
    ...vendidos.filter((v) => v.data_venda).map((v) => v.data_venda!.slice(0, 7)),
    ...itensGeral.filter((i) => i.data).map((i) => i.data.slice(0, 7)),
  ])).sort((a, b) => b.localeCompare(a));

  function calcLucroMes(m: string) {
    const veicsM = vendidos.filter((v) => v.data_venda?.startsWith(m));
    const lucroV = veicsM.reduce((s, v) => s + (calcLucro(v, v.despesas ?? [], v.receitas ?? []) ?? 0), 0);
    const saldoG = itensGeral.filter((i) => i.data?.startsWith(m)).reduce((s, i) => i.tipo === "receita" ? s + i.valor : s - i.valor, 0);
    return lucroV + saldoG;
  }

  const anoAtual = new Date().getFullYear().toString();
  const lucroAnual = mesesComDados.filter((m) => m.startsWith(anoAtual)).reduce((s, m) => s + calcLucroMes(m), 0);

  const filtrados = filtro === "todos" ? veiculos : filtro === "estoque" ? estoque : vendidos;

  return (
    <div className="p-6 md:p-10 bg-[#f4f4f2] min-h-screen font-sans">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="bg-gray-900 rounded-[2rem] p-5 md:p-7 text-white relative overflow-hidden">
          {/* Decoração de fundo */}
          <div className="absolute -right-16 -top-16 w-64 h-64 bg-white/5 rounded-full" />
          <div className="absolute -right-6 -bottom-20 w-48 h-48 bg-white/5 rounded-full" />

          <div className="relative">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
              <div>
                <p className="text-white/50 text-xs font-black uppercase tracking-[0.3em] mb-1">Financeiro</p>
                <h1 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter leading-none capitalize">
                  {mesLabel}
                </h1>
              </div>
              <span className={`px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest ${
                lucroMes >= 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
              }`}>
                {lucroMes >= 0 ? "▲" : "▼"} {margemMedia != null ? `${margemMedia.toFixed(1)}% margem` : "sem vendas"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 md:gap-10">
              <div>
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-2">Lucro Bruto do Mês</p>
                <p className={`text-3xl md:text-4xl font-black tracking-tighter leading-none ${lucroMes >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {fmtCompact(lucroMes)}
                </p>
                <p className="text-white/30 text-xs mt-1">veículos + outras receitas</p>
              </div>
              <div>
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-2">Faturamento</p>
                <p className="text-3xl md:text-4xl font-black tracking-tighter leading-none text-white">
                  {fmtCompact(faturamentoMes)}
                </p>
                <p className="text-white/30 text-xs mt-1">{vendidosMes.length} venda{vendidosMes.length !== 1 ? "s" : ""} no mês</p>
              </div>
              <div>
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-2">Acumulado {anoAtual}</p>
                <p className={`text-3xl md:text-4xl font-black tracking-tighter leading-none ${lucroAnual >= 0 ? "text-white" : "text-red-400"}`}>
                  {fmtCompact(lucroAnual)}
                </p>
                <p className="text-white/30 text-xs mt-1">{mesesComDados.filter((m) => m.startsWith(anoAtual)).length} mês(es) com dados</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── KPIs secundários ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Estoque em Custo", value: fmt(totalEstoqueCusto),
              sub: `${estoque.length} veículos`, icon: Package, color: "blue" as const,
            },
            {
              label: "Despesas do Mês", value: fmt(despesasMes),
              sub: "estoque + vendas", icon: TrendingDown, color: "red" as const,
            },
            {
              label: "Comissões a Pagar", value: fmt(totalComissoesMes),
              sub: `${vendedores.length} vendedor${vendedores.length !== 1 ? "es" : ""}`,
              icon: Users, color: "amber" as const, onClick: () => setVerComissoes(true),
            },
          ].map((k) => {
            const bg  = { blue: "bg-blue-50 border-blue-100", red: "bg-red-50 border-red-100", amber: "bg-amber-50 border-amber-100" };
            const ico = { blue: "text-blue-400", red: "text-red-400", amber: "text-amber-500" };
            return (
              <div key={k.label}
                className={`rounded-2xl border p-5 ${bg[k.color]} ${k.onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all" : ""}`}
                onClick={k.onClick}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{k.label}</p>
                  <k.icon size={15} className={ico[k.color]} />
                </div>
                <p className="text-xl font-black tracking-tighter text-gray-900">{k.value}</p>
                <p className="text-[10px] text-gray-400 mt-1">{k.sub}</p>
                {k.onClick && <p className="text-[8px] font-black uppercase tracking-widest text-gray-300 mt-2">clique para detalhes →</p>}
              </div>
            );
          })}

          {/* Card Outras Rec./Desp. — destaque por cor dinâmica */}
          <div
            className={`rounded-2xl border p-5 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all ${
              saldoGeral >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
            }`}
            onClick={() => setVerGeral(true)}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Outras Rec./Desp.</p>
              <button type="button" onClick={(e) => { e.stopPropagation(); setVerGeral(true); }}
                className="w-8 h-8 bg-gray-900 hover:bg-red-600 text-white rounded-xl flex items-center justify-center transition-colors">
                <Plus size={16} />
              </button>
            </div>
            <p className={`text-xl font-black tracking-tighter ${saldoGeral >= 0 ? "text-green-700" : "text-red-600"}`}>
              {fmt(saldoGeral)}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">saldo geral</p>
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-300 mt-2">clique para detalhes →</p>
          </div>
        </div>

        {/* ── Faixa de resultados ──────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 px-6 py-4">
          <div className="flex items-center gap-8 overflow-x-auto pb-1 scrollbar-hide">

            {mesesComDados.length === 0 ? (
              <p className="text-xs text-gray-300 py-2 whitespace-nowrap">Sem dados históricos ainda</p>
            ) : (
              <>
                {/* Label fixo à esquerda */}
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 whitespace-nowrap flex-shrink-0">
                  Resultados
                </p>

                <div className="w-px h-8 bg-gray-100 flex-shrink-0" />

                {/* Meses — ordem cronológica */}
                {[...mesesComDados].reverse().map((m) => {
                  const lucro   = calcLucroMes(m);
                  const ehAtual = m === mes;
                  return (
                    <div key={m} className="flex flex-col items-center gap-1 flex-shrink-0">
                      <span className={`text-xs font-black whitespace-nowrap ${lucro >= 0 ? "text-green-600" : "text-red-500"}`}>
                        {fmt(lucro)}
                      </span>
                      <span className={`text-[10px] font-bold capitalize whitespace-nowrap ${ehAtual ? "text-gray-700 font-black" : "text-gray-400"}`}>
                        {labelMes(m)}{ehAtual ? " ●" : ""}
                      </span>
                    </div>
                  );
                })}

                {/* Divisor + Total ano — sempre no final */}
                <div className="w-px h-8 bg-gray-100 flex-shrink-0 ml-auto" />
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <span className={`text-xs font-black whitespace-nowrap ${lucroAnual >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {fmt(lucroAnual)}
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 whitespace-nowrap">
                    Total {anoAtual}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Tabela de veículos + Histórico ───────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* Tabela */}
          <div className="xl:col-span-2 bg-white rounded-[2rem] border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex gap-1.5">
                {(["todos", "estoque", "vendido"] as const).map((f) => (
                  <button key={f} onClick={() => setFiltro(f)}
                    className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                      filtro === f ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-400 hover:text-gray-700"
                    }`}>
                    {f === "todos" ? "Todos" : f === "estoque" ? "Estoque" : "Vendidos"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <p className="text-[10px] text-gray-400 font-bold">{filtrados.length} veículo{filtrados.length !== 1 ? "s" : ""}</p>
                <Link href="/clientes"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-900 text-gray-500 hover:text-white transition-all text-[9px] font-black uppercase tracking-widest">
                  <Contact size={12} />
                  Clientes
                </Link>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
            ) : filtrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-300">
                <Car size={36} className="mb-3" />
                <p className="text-sm font-bold">Nenhum veículo</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {/* Cabeçalho */}
                <div className="hidden md:grid grid-cols-[auto_1fr_repeat(4,_80px)_64px] items-center px-5 py-2 bg-gray-50">
                  <div className="w-10" />
                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 pl-3">Veículo</p>
                  {["Compra", "Desp.", "Venda", "Lucro"].map((h) => (
                    <p key={h} className="text-[8px] font-black uppercase tracking-widest text-gray-400 text-right">{h}</p>
                  ))}
                  <div />
                </div>

                {filtrados.map((v) => {
                  const img       = v.capa_marketing_url ?? v.fotos?.[0];
                  const despTotal = (v.despesas ?? []).reduce((s, d) => s + d.valor, 0);
                  const recTotal  = (v.receitas ?? []).reduce((s, r) => s + r.valor, 0);
                  const lucro     = calcLucro(v, v.despesas ?? [], v.receitas ?? []);
                  const vendido   = v.status_venda === "VENDIDO";
                  const margem    = v.preco_compra && v.preco_venda_final
                    ? ((v.preco_venda_final - v.preco_compra) / v.preco_compra) * 100
                    : null;

                  return (
                    <button key={v.id} onClick={() => setSelecionado(v)}
                      className="w-full grid grid-cols-[auto_1fr] md:grid-cols-[auto_1fr_repeat(4,_80px)_64px] items-center px-5 py-3.5 hover:bg-gray-50 transition-colors text-left group gap-x-3">

                      {/* Foto */}
                      <div className="w-10 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                        {img
                          ? <img src={img} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                          : <div className="w-full h-full bg-gray-200 flex items-center justify-center"><Car size={12} className="text-gray-400" /></div>
                        }
                      </div>

                      {/* Nome */}
                      <div className="pl-3 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-black uppercase italic text-sm text-gray-900 truncate tracking-tight">
                            {v.marca} {v.modelo}
                          </p>
                          <span className={`flex-shrink-0 hidden sm:inline text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${
                            vendido ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                          }`}>
                            {vendido ? "Vendido" : "Estoque"}
                          </span>
                        </div>
                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider truncate">
                          {v.versao ?? "—"} · {v.ano_modelo ?? "—"}
                          {v.placa && <> · <span className="text-gray-600 font-black">{v.placa}</span></>}
                        </p>
                      </div>

                      {/* Números — só desktop */}
                      <p className="hidden md:block text-xs font-bold text-gray-600 text-right">{v.preco_compra ? fmt(v.preco_compra) : <span className="text-gray-300">—</span>}</p>
                      <p className="hidden md:block text-xs font-bold text-right">
                        {despTotal > 0 ? <span className="text-red-500">{fmt(despTotal)}</span> : <span className="text-gray-300">—</span>}
                      </p>
                      <p className="hidden md:block text-xs font-bold text-right">
                        {v.preco_venda_final ? <span className="text-gray-800">{fmt(v.preco_venda_final)}</span> : <span className="text-gray-300">—</span>}
                      </p>
                      <div className="hidden md:flex flex-col items-end">
                        {lucro != null ? (
                          <>
                            <span className={`text-xs font-black ${lucro >= 0 ? "text-green-600" : "text-red-500"}`}>{fmt(lucro)}</span>
                            {margem != null && (
                              <span className={`text-[8px] font-bold ${margem >= 0 ? "text-green-500" : "text-red-400"}`}>
                                {margem > 0 ? "+" : ""}{margem.toFixed(0)}%
                              </span>
                            )}
                          </>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </div>

                      {/* Seta */}
                      <div className="hidden md:flex justify-end">
                        <ArrowUpRight size={13} className="text-gray-300 group-hover:text-red-400 transition-colors" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Histórico mensal */}
            <div className="bg-white rounded-[2rem] border border-gray-100 p-6">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3">Histórico</p>

              {/* Próximo fechamento — destaque */}
              <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4">
                <div>
                  <p className="text-[8px] font-black uppercase tracking-widest text-amber-500">Próx. Fechamento</p>
                  <p className="text-sm font-black text-gray-800 mt-0.5">
                    {fechamentoDate
                      ? new Date(fechamentoDate + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
                      : "Não definido"}
                  </p>
                </div>
                <input
                  type="date"
                  value={fechamentoDate}
                  onChange={(e) => salvarFechamento(e.target.value)}
                  className="opacity-0 absolute w-0 h-0"
                  id="fechamento-input"
                />
                <label htmlFor="fechamento-input"
                  className="cursor-pointer px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors">
                  Alterar
                </label>
              </div>

              {mesesComDados.length === 0 ? (
                <p className="text-center text-xs text-gray-300 py-4">Nenhum dado ainda</p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {mesesComDados.map((m) => {
                    const lucro   = calcLucroMes(m);
                    const ehAtual = m === mes;
                    const fechado = fechamentoDate && m < mes;
                    const [ano, mesNum] = m.split("-");
                    const label = new Date(parseInt(ano), parseInt(mesNum) - 1, 1)
                      .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
                    return (
                      <div key={m} className={`flex items-center justify-between px-3 py-2.5 rounded-xl ${
                        ehAtual ? "bg-blue-50" : "bg-gray-50"
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            ehAtual ? "bg-blue-400" : fechado ? "bg-gray-300" : "bg-gray-200"
                          }`} />
                          <div>
                            <p className="text-xs font-black text-gray-800 capitalize">{label}</p>
                            {ehAtual && <p className="text-[7px] font-bold uppercase text-blue-400 tracking-widest">atual</p>}
                            {fechado && <p className="text-[7px] font-bold uppercase text-gray-400 tracking-widest">fechado</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {lucro >= 0
                            ? <ArrowUpRight size={10} className="text-green-500" />
                            : <ArrowDownRight size={10} className="text-red-500" />
                          }
                          <p className={`text-xs font-black ${lucro >= 0 ? "text-green-600" : "text-red-500"}`}>
                            {fmtCompact(lucro)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
        </div>
      </div>

      {/* SlideOver */}
      {selecionado && (
        <SlideOver
          veiculo={selecionado}
          vendedores={vendedores}
          onClose={() => { setSelecionado(null); carregar(); }}
          onReload={carregar}
        />
      )}

      {verComissoes && (
        <ModalComissoes vendedores={vendedores} veiculos={veiculos} mes={mes} onClose={() => setVerComissoes(false)} />
      )}

      {verGeral && (
        <ModalFinanceiroGeral itens={itensGeral} onAlterado={setItensGeral} onClose={() => setVerGeral(false)} />
      )}
    </div>
  );
}
