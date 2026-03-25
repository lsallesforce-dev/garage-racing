import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Camada extra de proteção além do middleware
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen bg-[#efefed]">
      <Sidebar />
      <div className="flex-1 flex flex-col pl-64 min-w-0">
        {children}
      </div>
    </div>
  );
}
