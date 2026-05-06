import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const vendedores = (data.users ?? []).filter(u => {
    const role    = u.app_metadata?.role    ?? u.user_metadata?.role;
    const ownerId = u.app_metadata?.owner_user_id ?? u.user_metadata?.owner_user_id;
    return ["vendedor", "dono"].includes(role) && ownerId === user.id;
  });

  return NextResponse.json({ vendedores });
}
