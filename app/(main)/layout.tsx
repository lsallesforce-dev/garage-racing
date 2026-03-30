import { redirect } from "next/navigation";
import { SidebarWrapper } from "@/components/SidebarWrapper";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <SidebarWrapper>{children}</SidebarWrapper>;
}
