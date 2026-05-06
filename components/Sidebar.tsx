"use client";

import { LayoutDashboard, MessageSquare, DollarSign, Users, ShieldCheck, Car, Store, Settings, LogOut, X, UserCircle, Contact, FileSignature, BarChart3, GitBranch, AlertCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const adminMenuItems = [
  { icon: LayoutDashboard, label: "Pátio Digital", href: "/dashboard" },
  { icon: Car, label: "Estoque Inteligente", href: "/estoque" },
  { icon: MessageSquare, label: "Central de Chat", href: "/chat" },
  { icon: DollarSign,  label: "Vendas / Financeiro", href: "/vendas" },
  { icon: Contact, label: "Clientes", href: "/clientes" },
  { icon: FileSignature, label: "Contratos", href: "/contratos" },
  { icon: Users, label: "Equipe de Vendas", href: "/vendedores" },
  { icon: Settings, label: "Configurações", href: "/configuracoes" },
  { icon: UserCircle, label: "Minha Conta", href: "/minha-conta" },
];

// Mapa completo de páginas disponíveis para vendedores
const todasPaginas = [
  { id: "dashboard",     icon: LayoutDashboard, label: "Pátio Digital",      href: "/dashboard" },
  { id: "estoque",       icon: Car,             label: "Estoque Inteligente", href: "/estoque" },
  { id: "chat",          icon: MessageSquare,   label: "Central de Chat",     href: "/chat" },
  { id: "financeiro",    icon: DollarSign,      label: "Vendas / Financeiro", href: "/vendas" },
  { id: "clientes",      icon: Contact,         label: "Clientes",            href: "/clientes" },
  { id: "contratos",     icon: FileSignature,   label: "Contratos",           href: "/contratos" },
  { id: "vendedores",    icon: Users,           label: "Equipe de Vendas",    href: "/vendedores" },
  { id: "configuracoes", icon: Settings,        label: "Configurações",       href: "/configuracoes" },
];

const DEFAULT_VENDEDOR_PAGINAS = ["estoque", "chat"];

interface SidebarProps {
  onClose?: () => void;
  isVendedor?: boolean;
  effectiveUserId?: string;
  paginasPermitidas?: string[];
}

export const Sidebar = ({ onClose, isVendedor = false, effectiveUserId = "", paginasPermitidas }: SidebarProps) => {
  const pathname = usePathname();
  const router = useRouter();
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [cargoUsuario, setCargoUsuario] = useState("");
  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [vitrineSlug, setVitrineSlug] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;

      if (isVendedor) {
        // Vendor: pull name from vendedores table, company from owner's config_garage
        const ownerId = effectiveUserId;
        supabase
          .from("vendedores")
          .select("nome, especialidade")
          .eq("auth_user_id", user.id)
          .maybeSingle()
          .then(({ data: v }) => {
            if (v) {
              setNomeUsuario(v.nome || "");
              setCargoUsuario(v.especialidade || "Vendedor");
            }
          });

        if (ownerId) {
          supabase
            .from("config_garage")
            .select("nome_empresa, nome_fantasia, vitrine_slug, webhook_token")
            .eq("user_id", ownerId)
            .limit(1)
            .then(({ data }) => {
              const row = data?.[0];
              if (row) {
                setNomeEmpresa(row.nome_fantasia || row.nome_empresa || "");
                setVitrineSlug(row.vitrine_slug || row.webhook_token || null);
              }
            });
        }
        return;
      }

      // Admin: pull from config_garage
      supabase
        .from("config_garage")
        .select("nome_usuario, cargo_usuario, nome_empresa, nome_fantasia, vitrine_slug, webhook_token")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          const row = data?.[0];
          if (row) {
            setNomeUsuario(row.nome_usuario || "");
            setCargoUsuario(row.cargo_usuario || "");
            setNomeEmpresa(row.nome_fantasia || row.nome_empresa || "");
            setVitrineSlug(row.vitrine_slug || row.webhook_token || null);
          }
        });
    });
  }, [isVendedor, effectiveUserId]);

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

  const vendedorMenuItems = isVendedor
    ? [
        ...todasPaginas.filter(p =>
          (paginasPermitidas ?? DEFAULT_VENDEDOR_PAGINAS).includes(p.id)
        ),
        { id: "minha-conta", icon: UserCircle, label: "Minha Conta", href: "/minha-conta" },
      ]
    : [];

  const menuItems = isVendedor ? vendedorMenuItems : adminMenuItems;

  return (
    <aside className="w-64 h-screen bg-[#e2e2de] border-r border-gray-300 px-5 py-5 flex flex-col">
      <div className="mb-6 px-1 flex items-start justify-between">
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
          <div className="flex items-center gap-1 mt-1.5 text-red-600">
            <ShieldCheck size={10} />
            <p className="text-[9px] font-black uppercase tracking-[0.2em]">
              {isVendedor ? "Acesso Vendedor" : "Painel Operacional"}
            </p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="md:hidden p-1 text-gray-400 hover:text-gray-700 transition-colors" aria-label="Fechar menu">
            <X size={18} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto">
        {menuItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            onClick={onClose}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
              pathname === item.href ? "bg-white text-red-600 shadow-sm" : "text-gray-600 hover:bg-white/50"
            }`}
          >
            <item.icon size={16} />
            <span className="font-bold text-[11px] uppercase tracking-wider">{item.label}</span>
          </Link>
        ))}
        {/* Vitrine Pública — somente para admin */}
        {!isVendedor && (
          <a
            href={vitrineSlug ? `/vitrine/${vitrineSlug}` : "/vitrine"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-gray-600 hover:bg-white/50"
          >
            <Store size={16} />
            <span className="font-bold text-[11px] uppercase tracking-wider">Vitrine Pública</span>
          </a>
        )}
      </nav>

      {/* Log de Erros — visível só para admin */}
      {!isVendedor && (
        <Link
          href="/erros"
          onClick={onClose}
          className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all mb-2 ${
            pathname === "/erros" ? "bg-white text-red-600 shadow-sm" : "text-gray-400 hover:bg-white/50"
          }`}
        >
          <AlertCircle size={13} />
          <span className="font-bold text-[10px] uppercase tracking-wider">Log de Erros</span>
        </Link>
      )}

      {/* Perfil do Usuário */}
      <div className="pt-3 border-t border-gray-300 flex items-center gap-3">
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
