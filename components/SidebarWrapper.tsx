"use client";

import { createContext, useContext, useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { ZapWidget } from "./ZapWidget";
import { Menu } from "lucide-react";

// ─── User Role Context ────────────────────────────────────────────────────────

interface UserRoleContextValue {
  effectiveUserId: string;
  isVendedor: boolean;
}

const UserRoleContext = createContext<UserRoleContextValue | null>(null);

export function useUserRole(): UserRoleContextValue {
  const ctx = useContext(UserRoleContext);
  if (!ctx) throw new Error("useUserRole must be used inside SidebarWrapper");
  return ctx;
}

// ─── AdminSessionDetector ─────────────────────────────────────────────────────

function AdminSessionDetector({ effectiveUserId }: { effectiveUserId: string }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!effectiveUserId) return;
    if (searchParams.get("admin_session") === "1") {
      sessionStorage.setItem("autozap_admin_uid", effectiveUserId);
    } else {
      const savedUid = sessionStorage.getItem("autozap_admin_uid");
      if (savedUid && savedUid !== effectiveUserId) sessionStorage.removeItem("autozap_admin_uid");
    }
  }, [searchParams, effectiveUserId]);
  return null;
}

// ─── SidebarWrapper ───────────────────────────────────────────────────────────

export interface GarageConfig {
  nomeEmpresa:  string;
  nomeUsuario:  string;
  cargoUsuario: string;
  vitrineSlug:  string | null;
}

interface SidebarWrapperProps {
  children: React.ReactNode;
  isVendedor?: boolean;
  effectiveUserId?: string;
  garageConfig?: GarageConfig;
  paginasPermitidas?: string[];
}

export function SidebarWrapper({
  children,
  isVendedor = false,
  effectiveUserId = "",
  garageConfig,
  paginasPermitidas,
}: SidebarWrapperProps) {
  const [open, setOpen] = useState(false);

  // Divide nome para colorir metade no header mobile
  const nomeEmpresa = garageConfig?.nomeEmpresa ?? "";
  const meio        = Math.ceil(nomeEmpresa.length / 2);

  return (
    <UserRoleContext.Provider value={{ effectiveUserId, isVendedor }}>
      <Suspense fallback={null}>
        <AdminSessionDetector effectiveUserId={effectiveUserId} />
      </Suspense>

      <div className="flex min-h-screen bg-[#efefed]">
        {open && (
          <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setOpen(false)} />
        )}

        <div className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
          <Sidebar
            isVendedor={isVendedor}
            effectiveUserId={effectiveUserId}
            garageConfig={garageConfig}
            paginasPermitidas={paginasPermitidas}
            onClose={() => setOpen(false)}
          />
        </div>

        <div className="flex-1 flex flex-col md:pl-64 min-w-0">
          {/* Header mobile */}
          <div className="md:hidden flex items-center gap-3 bg-[#e2e2de] border-b border-gray-300 px-4 py-3 sticky top-0 z-30">
            <button onClick={() => setOpen(true)} className="p-2 rounded-lg hover:bg-gray-200 transition-colors" aria-label="Abrir menu">
              <Menu size={20} />
            </button>
            <span className="font-black text-base tracking-tighter italic">
              {nomeEmpresa ? (
                <>
                  <span className="text-gray-900">{nomeEmpresa.slice(0, meio)}</span>
                  <span className="text-red-600">{nomeEmpresa.slice(meio)}</span>
                </>
              ) : (
                <><span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span></>
              )}
            </span>
          </div>

          {children}
        </div>
      </div>

      <ZapWidget userId={effectiveUserId} />
    </UserRoleContext.Provider>
  );
}
