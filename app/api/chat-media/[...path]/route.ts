// app/api/chat-media/[...path]/route.ts
//
// Proxy autenticado pro bucket PRIVADO "fotos-clientes" (fotos que o cliente
// manda pelo WhatsApp — antes só o preview minúsculo do JPEGThumbnail do
// WhatsApp era exibido; agora a foto real fica aqui, decriptada, e o painel
// pede via esta rota em vez de bater direto no Storage).
//
// Mesmo motivo do proxy de vídeo do R2 (lib/r2-url.ts): bucket privado não
// pode virar URL pública gravada pra sempre em `mensagens.media_url` (signed
// URL expira; URL pública vazaria foto de cliente pra qualquer um com o link).
// Path: {tenantUserId}/{leadId}/{arquivo} — a posse do lead já garante a posse
// do tenant, então valida só o lead (mesmo padrão de requireLeadOwner).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireLeadOwner } from "@/lib/api-auth";

const BUCKET = "fotos-clientes";

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.length < 2) {
    return NextResponse.json({ error: "Caminho inválido" }, { status: 400 });
  }
  const [, leadId] = path; // [tenantUserId, leadId, arquivo]

  const { error } = await requireLeadOwner(leadId);
  if (error) return error;

  const fullPath = path.join("/");
  const { data, error: dlError } = await supabaseAdmin.storage.from(BUCKET).download(fullPath);
  if (dlError || !data) {
    return NextResponse.json({ error: "Foto não encontrada" }, { status: 404 });
  }

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      "Content-Type": data.type || "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
