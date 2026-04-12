import { redirect } from "next/navigation";
import { SidebarWrapper } from "@/components/SidebarWrapper";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Novo usuário sem config → onboarding obrigatório
  const { data: config } = await supabase
    .from("config_garage")
    .select("nome_empresa")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!config?.nome_empresa) redirect("/onboarding");

  return <SidebarWrapper>{children}</SidebarWrapper>;
}
