import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SidebarWrapper } from "@/components/SidebarWrapper";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// App instalável (PWA) só no painel: o manifest NÃO vai no layout raiz porque
// as vitrines dos tenants (domínio próprio) também passam por ele, e o cliente
// final que "instalasse" a vitrine da loja ganharia um ícone do AutoZap.
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  // iOS não lê `display: standalone` do manifest nem aceita ícone SVG.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "AutoZap" },
  // `icons` aqui substitui o do layout raiz inteiro — o favicon vai junto.
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }], shortcut: "/favicon.svg", apple: "/app/apple-icon.png" },
};

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const appMeta  = user.app_metadata  as { role?: string; owner_user_id?: string; aprovado?: boolean; paginas_permitidas?: string[] } | undefined;
  const userMeta = user.user_metadata as { role?: string; owner_user_id?: string; aprovado?: boolean; paginas_permitidas?: string[] } | undefined;
  const role        = appMeta?.role        ?? userMeta?.role;
  const aprovado    = appMeta?.aprovado    ?? userMeta?.aprovado;
  const ownerUserId = appMeta?.owner_user_id ?? userMeta?.owner_user_id;

  if (aprovado === false) redirect("/aguardando");

  const isVendedor      = role === "vendedor";
  const effectiveUserId = isVendedor ? (ownerUserId ?? user.id) : user.id;

  // ── Vendedor ───────────────────────────────────────────────────────────────
  if (isVendedor) {
    const { headers } = await import("next/headers");
    const headersList = await headers();
    const pathname    = headersList.get("x-pathname") ?? "";

    const rotasPermitidas = ["/estoque", "/chat", "/veiculo", "/upload", "/clientes", "/contratos", "/financiamento", "/minha-conta"];
    if (!rotasPermitidas.some(r => pathname === r || pathname.startsWith(r + "/"))) redirect("/estoque");

    // Busca dados do vendedor + config do dono em paralelo — server-side, zero roundtrip no cliente
    const [{ data: vendedor }, { data: ownerConfigRows }] = await Promise.all([
      supabase.from("vendedores").select("nome, especialidade").eq("auth_user_id", user.id).maybeSingle(),
      supabase.from("config_garage").select("nome_empresa, nome_fantasia, vitrine_slug").eq("user_id", effectiveUserId).limit(1),
    ]);

    const ownerConfig = ownerConfigRows?.[0];
    const paginasPermitidas = appMeta?.paginas_permitidas ?? userMeta?.paginas_permitidas;

    return (
      <SidebarWrapper
        isVendedor={true}
        effectiveUserId={effectiveUserId}
        garageConfig={{
          nomeEmpresa:  ownerConfig?.nome_fantasia || ownerConfig?.nome_empresa || "",
          nomeUsuario:  vendedor?.nome || "",
          cargoUsuario: vendedor?.especialidade || "Vendedor",
          // Só o slug. O webhook_token NÃO entra aqui: ele é a credencial do
          // /api/webhook/avisa, e usá-lo como URL pública da vitrine publicava
          // o segredo em todo link que a loja manda pro cliente.
          vitrineSlug:  ownerConfig?.vitrine_slug || null,
        }}
        paginasPermitidas={Array.isArray(paginasPermitidas) ? paginasPermitidas : undefined}
      >
        {children}
      </SidebarWrapper>
    );
  }

  // ── Admin ──────────────────────────────────────────────────────────────────
  // Uma única query traz tudo que o sidebar + verificação de plano precisam
  const { data: config } = await supabase
    .from("config_garage")
    .select("nome_empresa, nome_fantasia, nome_usuario, cargo_usuario, vitrine_slug, plano_ativo, trial_ends_at, plano_vence_em")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!config?.nome_empresa) redirect("/onboarding");

  const agora           = new Date();
  const trialConfigurado = config.trial_ends_at != null;
  const trialValido      = trialConfigurado && new Date(config.trial_ends_at) > agora;
  const planoValido      = config.plano_ativo === true && config.plano_vence_em && new Date(config.plano_vence_em) > agora;

  if (trialConfigurado && !trialValido && !planoValido) redirect("/assinar");

  return (
    <SidebarWrapper
      isVendedor={false}
      effectiveUserId={user.id}
      garageConfig={{
        nomeEmpresa:  config.nome_fantasia || config.nome_empresa || "",
        nomeUsuario:  config.nome_usuario || "",
        cargoUsuario: config.cargo_usuario || "",
        vitrineSlug:  config.vitrine_slug || null,   // nunca o webhook_token — ver comentário acima
      }}
    >
      {children}
    </SidebarWrapper>
  );
}
