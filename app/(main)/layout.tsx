import { redirect } from "next/navigation";
import { SidebarWrapper } from "@/components/SidebarWrapper";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

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

  return <SidebarWrapper>{children}</SidebarWrapper>;
}
