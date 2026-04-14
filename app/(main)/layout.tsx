import { redirect } from "next/navigation";
import { SidebarWrapper } from "@/components/SidebarWrapper";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Detect vendor role from user metadata
  const meta = user.user_metadata as { role?: string; owner_user_id?: string } | undefined;
  const isVendedor = meta?.role === "vendedor";
  const effectiveUserId = isVendedor ? (meta?.owner_user_id ?? user.id) : user.id;

  if (isVendedor) {
    // Rotas permitidas para vendedor — qualquer outra redireciona para /estoque
    const { headers } = await import("next/headers");
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") ?? headersList.get("x-invoke-path") ?? "";

    const rotasPermitidas = ["/estoque", "/chat", "/veiculo"];
    const permitido = rotasPermitidas.some((r) => pathname === r || pathname.startsWith(r + "/"));

    // Fallback seguro: se não conseguir ler o pathname, deixa passar
    // (o middleware ou a própria página bloqueia se necessário)
    if (pathname && !permitido) {
      redirect("/estoque");
    }

    return (
      <SidebarWrapper isVendedor={true} effectiveUserId={effectiveUserId}>
        {children}
      </SidebarWrapper>
    );
  }

  const { data: config } = await supabase
    .from("config_garage")
    .select("nome_empresa, plano_ativo, trial_ends_at, plano_vence_em")
    .eq("user_id", user.id)
    .maybeSingle();

  // Novo usuário sem config → onboarding
  if (!config?.nome_empresa) redirect("/onboarding");

  // Verifica acesso — fail-open se colunas ainda não existem (null)
  const agora = new Date();
  const trialConfigurado = config.trial_ends_at != null;
  const trialValido = trialConfigurado && new Date(config.trial_ends_at) > agora;
  const planoValido = config.plano_ativo === true && config.plano_vence_em && new Date(config.plano_vence_em) > agora;

  if (trialConfigurado && !trialValido && !planoValido) redirect("/assinar");

  return (
    <SidebarWrapper isVendedor={false} effectiveUserId={user.id}>
      {children}
    </SidebarWrapper>
  );
}
