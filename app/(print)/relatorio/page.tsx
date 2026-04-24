"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function calcLucro(v: any): number | null {
  if (!v.preco_venda_final || !v.preco_compra) return null;
  const desp = (v.despesas ?? []).reduce((s: number, d: any) => s + d.valor, 0);
  const rec  = (v.receitas  ?? []).reduce((s: number, r: any) => s + r.valor, 0);
  return v.preco_venda_final - v.preco_compra - desp + rec;
}

function labelMesLongo(m: string) {
  const [ano, mesNum] = m.split("-");
  return new Date(parseInt(ano), parseInt(mesNum) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function RelatorioContent() {
  const params = useSearchParams();
  const mes    = params.get("mes") ?? "";

  const [veiculos,   setVeiculos]   = useState<any[]>([]);
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [itensGeral, setItensGeral] = useState<any[]>([]);
  const [empresa,    setEmpresa]    = useState("");
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    if (!mes) return;
    fetch("/api/financeiro/resumo")
      .then(r => r.json())
      .then(({ veiculos: v, vendedores: vd, geral }) => {
        setVeiculos(v ?? []);
        setVendedores(vd ?? []);
        setItensGeral(geral ?? []);
        setLoading(false);
      });

    // Tenta pegar nome da empresa
    fetch("/api/config")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.nome_empresa) setEmpresa(d.nome_empresa); })
      .catch(() => {});
  }, [mes]);

  useEffect(() => {
    if (!loading) setTimeout(() => window.print(), 400);
  }, [loading]);

  if (!mes) return <p className="p-10 text-red-600">Parâmetro ?mes= obrigatório</p>;
  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const vendidosMes  = veiculos.filter((v: any) => v.status_venda === "VENDIDO" && v.data_venda?.startsWith(mes));
  const faturamento  = vendidosMes.reduce((s: number, v: any) => s + (v.preco_venda_final ?? 0), 0);
  const custoTotal   = vendidosMes.reduce((s: number, v: any) => s + (v.preco_compra ?? 0) + (v.despesas ?? []).reduce((d: number, x: any) => d + x.valor, 0), 0);
  const lucroBruto   = vendidosMes.reduce((s: number, v: any) => s + (calcLucro(v) ?? 0), 0);
  const saldoGeral   = itensGeral.filter((i: any) => i.data?.startsWith(mes)).reduce((s: number, i: any) => i.tipo === "receita" ? s + i.valor : s - i.valor, 0);
  const comissoes    = vendedores.reduce((s: number, vend: any) => {
    const vs = vendidosMes.filter((v: any) => v.vendedor_id === vend.id);
    const l  = vs.reduce((ll: number, v: any) => ll + (calcLucro(v) ?? 0), 0);
    return s + (l * vend.comissao_pct) / 100;
  }, 0);
  const lucroLiquido = lucroBruto + saldoGeral - comissoes;

  const dataImpressao = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="font-sans text-gray-900 max-w-[900px] mx-auto px-10 py-10 print:p-0">
      <style>{`
        @media print {
          @page { margin: 1.5cm; size: A4; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Cabeçalho */}
      <div className="flex items-start justify-between mb-8 pb-6 border-b-2 border-gray-900">
        <div>
          <h1 className="text-2xl font-black uppercase italic tracking-tighter text-gray-900">
            {empresa || "Relatório Financeiro"}
          </h1>
          <p className="text-sm font-bold text-gray-500 uppercase tracking-widest mt-1">
            Relatório Mensal — <span className="capitalize">{labelMesLongo(mes)}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Gerado em</p>
          <p className="text-sm font-black text-gray-700">{dataImpressao}</p>
          <button onClick={() => window.print()}
            className="no-print mt-2 px-4 py-1.5 bg-gray-900 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors">
            Imprimir / PDF
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3 mb-8">
        {[
          { label: "Faturamento",   value: fmt(faturamento),  dark: false },
          { label: "Custo Total",   value: fmt(custoTotal),   dark: false },
          { label: "Lucro Bruto",   value: fmt(lucroBruto),   dark: false },
          { label: "Comissões",     value: fmt(comissoes),    dark: false },
          { label: "Lucro Líquido", value: fmt(lucroLiquido), dark: true  },
        ].map(k => (
          <div key={k.label} className={`rounded-xl px-4 py-3 border ${k.dark ? "bg-gray-900 border-gray-900 text-white" : "bg-gray-50 border-gray-200"}`}>
            <p className={`text-[8px] font-black uppercase tracking-widest mb-1 ${k.dark ? "text-white/50" : "text-gray-400"}`}>{k.label}</p>
            <p className={`text-sm font-black ${k.dark ? (lucroLiquido >= 0 ? "text-green-400" : "text-red-400") : "text-gray-900"}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tabela de vendas */}
      <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
        Veículos Vendidos ({vendidosMes.length})
      </h2>
      {vendidosMes.length === 0 ? (
        <p className="text-sm text-gray-400 italic mb-8">Nenhuma venda no período.</p>
      ) : (
        <table className="w-full text-left mb-8 text-xs">
          <thead>
            <tr className="border-b-2 border-gray-900">
              {["Veículo", "Data", "Compra", "Desp.", "Venda", "Lucro", "Margem", "Vendedor"].map(h => (
                <th key={h} className="pb-2 pr-3 font-black uppercase tracking-widest text-[8px] text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vendidosMes.map((v: any) => {
              const despTotal = (v.despesas ?? []).reduce((s: number, d: any) => s + d.valor, 0);
              const lucro     = calcLucro(v);
              const margem    = v.preco_compra && v.preco_venda_final
                ? ((v.preco_venda_final - v.preco_compra) / v.preco_compra) * 100 : null;
              const vend      = vendedores.find((vd: any) => vd.id === v.vendedor_id);
              return (
                <tr key={v.id} className="border-b border-gray-100">
                  <td className="py-2 pr-3">
                    <span className="font-black uppercase italic">{v.marca} {v.modelo}</span>
                    <span className="block text-[9px] text-gray-400">{v.versao ?? ""} {v.ano_modelo ?? ""}</span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {v.data_venda ? new Date(v.data_venda + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—"}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{v.preco_compra ? fmt(v.preco_compra) : "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-red-600">{despTotal > 0 ? fmt(despTotal) : "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap font-bold">{v.preco_venda_final ? fmt(v.preco_venda_final) : "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap font-black">
                    {lucro != null ? <span className={lucro >= 0 ? "text-green-700" : "text-red-600"}>{fmt(lucro)}</span> : "—"}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {margem != null ? `${margem > 0 ? "+" : ""}${margem.toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-2 text-gray-500">{vend?.nome ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-900 font-black">
              <td className="pt-2 text-[9px] text-gray-400 uppercase tracking-widest">{vendidosMes.length} vendas</td>
              <td /><td className="pt-2">{fmt(custoTotal)}</td><td />
              <td className="pt-2">{fmt(faturamento)}</td>
              <td className="pt-2 text-green-700">{fmt(lucroBruto)}</td>
              <td /><td />
            </tr>
          </tfoot>
        </table>
      )}

      {/* Tabela de comissões */}
      <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Comissões</h2>
      {vendedores.length === 0 ? (
        <p className="text-sm text-gray-400 italic mb-8">Nenhum vendedor cadastrado.</p>
      ) : (
        <table className="w-full text-left mb-8 text-xs">
          <thead>
            <tr className="border-b-2 border-gray-900">
              {["Vendedor", "Vendas", "Faturamento", "Lucro Gerado", "Comissão %", "Valor a Pagar"].map(h => (
                <th key={h} className="pb-2 pr-6 font-black uppercase tracking-widest text-[8px] text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vendedores.map((vend: any) => {
              const vs     = vendidosMes.filter((v: any) => v.vendedor_id === vend.id);
              const fat    = vs.reduce((s: number, v: any) => s + (v.preco_venda_final ?? 0), 0);
              const lucroV = vs.reduce((s: number, v: any) => s + (calcLucro(v) ?? 0), 0);
              const com    = (lucroV * vend.comissao_pct) / 100;
              return (
                <tr key={vend.id} className="border-b border-gray-100">
                  <td className="py-2 pr-6 font-black">{vend.nome}</td>
                  <td className="py-2 pr-6">{vs.length}</td>
                  <td className="py-2 pr-6">{fmt(fat)}</td>
                  <td className="py-2 pr-6"><span className={lucroV >= 0 ? "text-green-700" : "text-red-600"}>{fmt(lucroV)}</span></td>
                  <td className="py-2 pr-6 text-amber-600 font-bold">{vend.comissao_pct}%</td>
                  <td className="py-2 font-black text-amber-700">{fmt(com)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-900 font-black">
              <td className="pt-2 text-[9px] text-gray-400 uppercase tracking-widest" colSpan={5}>Total comissões</td>
              <td className="pt-2 text-amber-700">{fmt(comissoes)}</td>
            </tr>
          </tfoot>
        </table>
      )}

      {/* Resumo Final */}
      <div className="border-t-2 border-gray-900 pt-5 grid grid-cols-3 gap-4">
        {[
          { label: "Lucro Bruto Veículos", value: fmt(lucroBruto) },
          { label: "Outras Rec./Desp.",    value: fmt(saldoGeral) },
          { label: "(-) Comissões",        value: fmt(-comissoes) },
        ].map(k => (
          <div key={k.label}>
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">{k.label}</p>
            <p className="text-sm font-bold text-gray-700 mt-0.5">{k.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 bg-gray-900 rounded-xl px-6 py-4 flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-white/50">Lucro Líquido do Mês</p>
        <p className={`text-2xl font-black tracking-tighter ${lucroLiquido >= 0 ? "text-green-400" : "text-red-400"}`}>
          {fmt(lucroLiquido)}
        </p>
      </div>

      <p className="text-center text-[8px] text-gray-300 mt-10 uppercase tracking-widest">
        Documento gerado automaticamente — {dataImpressao}
      </p>
    </div>
  );
}

export default function RelatorioPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" /></div>}>
      <RelatorioContent />
    </Suspense>
  );
}
