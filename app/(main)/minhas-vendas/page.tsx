"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUserRole } from "@/components/SidebarWrapper";
import { DollarSign, TrendingUp, ShoppingBag, Loader2, Wallet } from "lucide-react";

interface Venda {
  id: string;
  carro: string;
  ano: number | null;
  data_venda: string | null;
  valor_venda: number;
  comissao: number;
}
interface Resumo {
  vendas_total: number;
  vendas_mes: number;
  comissao_mes: number;
  comissao_total: number;
  valor_vendido_mes: number;
}

const fmt = (v: number) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—");

export default function MinhasVendasPage() {
  const router = useRouter();
  const { isVendedor } = useUserRole();
  const [loading, setLoading] = useState(true);
  const [nome, setNome] = useState("");
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [vendas, setVendas] = useState<Venda[]>([]);

  // Dono/gerente usa o financeiro completo
  useEffect(() => {
    if (isVendedor === false) router.replace("/vendas");
  }, [isVendedor, router]);

  useEffect(() => {
    fetch("/api/vendedor/minhas-vendas")
      .then((r) => r.json())
      .then((d) => {
        setNome(d.vendedor?.nome ?? "");
        setResumo(d.resumo);
        setVendas(d.vendas ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (isVendedor === false) return null;

  return (
    <main className="flex-1 p-4 sm:p-10 bg-[#efefed] min-h-screen">
      <header className="mb-8 pb-6 border-b border-gray-200">
        <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">
          Minhas Vendas
        </h1>
        <p className="text-gray-400 uppercase tracking-widest text-[10px] font-bold mt-1">
          {nome ? `Olá, ${nome}` : "Seu desempenho"} • Comissões e vendas
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="max-w-4xl flex flex-col gap-6">

          {/* Cards de resumo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Comissão do mês — destaque */}
            <div className="bg-gray-900 rounded-[2rem] p-6 text-white sm:col-span-1">
              <div className="flex items-center gap-2 mb-2">
                <Wallet size={15} className="text-green-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-white/50">
                  Comissão deste mês
                </span>
              </div>
              <p className="text-3xl font-black italic">{fmt(resumo?.comissao_mes ?? 0)}</p>
              <p className="text-[10px] text-white/40 mt-1">{resumo?.vendas_mes ?? 0} venda(s) no mês</p>
            </div>

            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={15} className="text-gray-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Comissão acumulada
                </span>
              </div>
              <p className="text-2xl font-black text-gray-900">{fmt(resumo?.comissao_total ?? 0)}</p>
              <p className="text-[10px] text-gray-400 mt-1">Total geral</p>
            </div>

            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingBag size={15} className="text-gray-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Total de vendas
                </span>
              </div>
              <p className="text-2xl font-black text-gray-900">{resumo?.vendas_total ?? 0}</p>
              <p className="text-[10px] text-gray-400 mt-1">{fmt(resumo?.valor_vendido_mes ?? 0)} vendidos no mês</p>
            </div>
          </div>

          {/* Lista de vendas */}
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 sm:p-8">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-5">
              Histórico de vendas
            </h2>

            {vendas.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                  <DollarSign size={22} className="text-gray-300" />
                </div>
                <p className="text-sm text-gray-400">Você ainda não tem vendas registradas.</p>
                <p className="text-[11px] text-gray-300">Suas comissões aparecem aqui assim que fechar uma venda.</p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-gray-100">
                {vendas.map((v) => (
                  <div key={v.id} className="flex items-center justify-between py-3.5 gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {v.carro}{v.ano ? ` ${v.ano}` : ""}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {fmtData(v.data_venda)} • venda {fmt(v.valor_venda)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Comissão</p>
                      <p className="text-sm font-black text-green-600">{fmt(v.comissao)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[10px] text-gray-400 text-center">
            Dúvidas sobre uma comissão? Fale com a gerência.
          </p>
        </div>
      )}
    </main>
  );
}
