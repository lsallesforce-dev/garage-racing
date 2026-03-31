"use client";

import { LayoutDashboard, PlusSquare, MessageSquare, DollarSign, Users, ShieldCheck, Car, Store, Settings, LogOut, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const menuItems: { icon: any; label: string; href: string; badge?: number }[] = [
  { icon: LayoutDashboard, label: "Pátio Digital", href: "/" },
  { icon: Car, label: "Estoque Inteligente", href: "/estoque" },
  { icon: PlusSquare, label: "Adicionar Estoque", href: "/upload" },
  { icon: MessageSquare, label: "Central de Chat", href: "/chat" },
  { icon: DollarSign, label: "Vendas / Financeiro", href: "/vendas" },
  { icon: Users, label: "Equipe de Vendas", href: "/vendedores" },
  { icon: Store, label: "Vitrine Pública", href: "/vitrine" },
  { icon: Settings, label: "Configurações", href: "/configuracoes" },
];

export const Sidebar = ({ onClose }: { onClose?: () => void }) => {
  const pathname = usePathname();
  const router = useRouter();
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [cargoUsuario, setCargoUsuario] = useState("");
  const [nomeEmpresa, setNomeEmpresa] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("config_garage")
        .select("nome_usuario, cargo_usuario, nome_empresa")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          const row = data?.[0];
          if (row) {
            setNomeUsuario(row.nome_usuario || "");
            setCargoUsuario(row.cargo_usuario || "");
            setNomeEmpresa(row.nome_empresa || "");
          }
        });
    });
  }, []);

  const iniciais = nomeUsuario
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p: string) => p[0].toUpperCase())
    .join("") || "?";

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-64 h-screen bg-[#e2e2de] border-r border-gray-300 p-6 flex flex-col">
      <div className="mb-10 px-2 flex items-start justify-between">
        <div>
        <h2 className="text-xl font-black tracking-tighter italic border-b border-gray-400/20 pb-2">
          {nomeEmpresa ? (
            <>
              <span className="text-gray-900">{nomeEmpresa.split(" ")[0]}</span>
              {nomeEmpresa.split(" ").length > 1 && (
                <span className="text-red-600"> {nomeEmpresa.split(" ").slice(1).join(" ")}</span>
              )}
            </>
          ) : (
            <><span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span></>
          )}
        </h2>
        <div className="flex items-center gap-1 mt-2 text-red-600">
          <ShieldCheck size={10} />
          <p className="text-[9px] font-black uppercase tracking-[0.2em]">Painel Operacional</p>
        </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="md:hidden p-1 text-gray-400 hover:text-gray-700 transition-colors" aria-label="Fechar menu">
            <X size={18} />
          </button>
        )}
      </div>
      
      <nav className="flex-1 space-y-2">
        {menuItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            onClick={onClose}
            className={`flex items-center justify-between p-3 rounded-xl transition-all ${
              pathname === item.href ? "bg-white text-red-600 shadow-sm" : "text-gray-600 hover:bg-white/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <item.icon size={18} />
              <span className="font-bold text-[11px] uppercase tracking-wider">{item.label}</span>
            </div>
            {item.badge && <span className="bg-red-600 text-white text-[9px] px-2 py-0.5 rounded-full font-black">{item.badge}</span>}
          </Link>
        ))}
      </nav>

      {/* Perfil do Usuário */}
      <div className="mt-10 pt-6 border-t border-gray-300 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white font-black text-sm italic shadow-lg">{iniciais}</div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-[11px] font-black uppercase tracking-tight text-gray-900 truncate">{nomeUsuario || "—"}</span>
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest italic truncate">{cargoUsuario || "—"}</span>
        </div>
        <button
          onClick={handleLogout}
          title="Sair"
          className="text-gray-400 hover:text-red-600 transition-colors"
        >
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
};
