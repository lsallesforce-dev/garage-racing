import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const PAGINAS_VALIDAS = [
  "dashboard", "estoque", "chat", "financeiro",
  "clientes", "contratos", "vendedores", "configuracoes",
];

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  if (user!.user_metadata?.role === "vendedor") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { vendedor_id, paginas } = await req.json();
  if (!vendedor_id || !Array.isArray(paginas)) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const paginasFiltradas = paginas.filter((p: string) => PAGINAS_VALIDAS.includes(p));

  // Busca metadata atual para fazer merge sem apagar role/owner_user_id
  const { data: vendedorData } = await supabaseAdmin.auth.admin.getUserById(vendedor_id);
  if (!vendedorData?.user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  // Garante que é vendedor do mesmo tenant
  const ownerUserId = vendedorData.user.user_metadata?.owner_user_id;
  if (ownerUserId !== user!.id) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(vendedor_id, {
    user_metadata: {
      ...vendedorData.user.user_metadata,
      paginas_permitidas: paginasFiltradas,
    },
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, paginas: paginasFiltradas });
}
