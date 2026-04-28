import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { consultarNFe } from "@/lib/focusnfe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const { ref } = await params;

  try {
    const data = await consultarNFe(ref);

    // Atualiza status no banco se mudou
    if (data.status && ref.startsWith("nfe-")) {
      const veiculoId = ref.replace("nfe-", "");
      await supabaseAdmin.from("veiculos").update({
        nf_status: data.status,
        nf_chave: data.chave_nfe ?? null,
        nf_pdf_url: data.danfe_url ?? null,
        nf_xml_url: data.xml_url ?? null,
      }).eq("id", veiculoId);
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
