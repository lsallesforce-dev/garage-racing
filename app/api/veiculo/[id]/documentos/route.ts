// app/api/veiculo/[id]/documentos/route.ts
//
// Documentos arquivados do veículo (PDFs sensíveis: CRLV, laudo, etc.).
// Os arquivos ficam num bucket PRIVADO (documentos-veiculos) — o acesso é
// sempre por signed URL gerada no servidor, nunca por URL pública. No banco
// só guardamos metadados em veiculos.documentos (jsonb).
//
//   GET    → lista os docs com signed URL (1h)
//   POST   → upload de 1+ PDFs (multipart "files")
//   DELETE → remove um doc (body { docId })

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { randomUUID } from "crypto";

const BUCKET = "documentos-veiculos";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — igual ao limite do bucket

interface DocMeta {
  id: string;
  nome: string;
  path: string;
  tamanho: number;
  enviado_em: string;
}

function lerDocs(documentos: unknown): DocMeta[] {
  return Array.isArray(documentos) ? (documentos as DocMeta[]) : [];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await requireVehicleOwner(id);
  if (error) return error;

  const { data: veic } = await supabaseAdmin
    .from("veiculos")
    .select("documentos")
    .eq("id", id)
    .single();

  const docs = lerDocs(veic?.documentos);

  // Signed URL temporária (1h) por documento — nunca expõe URL pública do bucket privado
  const comUrl = await Promise.all(
    docs.map(async (d) => {
      const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(d.path, 3600);
      return { id: d.id, nome: d.nome, tamanho: d.tamanho, enviado_em: d.enviado_em, url: signed?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ documentos: comUrl });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireVehicleOwner(id);
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
  }

  const { data: veic } = await supabaseAdmin
    .from("veiculos")
    .select("documentos")
    .eq("id", id)
    .single();
  const docs = lerDocs(veic?.documentos);

  const novos: DocMeta[] = [];
  for (const file of files) {
    // Validação dupla (o bucket também restringe, mas falhamos cedo com mensagem clara)
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: `"${file.name}" não é PDF — só aceitamos PDF.` }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `"${file.name}" passa de 10 MB.` }, { status: 400 });
    }
    const docId = randomUUID();
    const path = `${userId}/${id}/${docId}.pdf`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: "application/pdf", upsert: false });
    if (upErr) {
      // limpa o que já subiu neste request pra não deixar órfão
      if (novos.length) await supabaseAdmin.storage.from(BUCKET).remove(novos.map((n) => n.path)).catch(() => {});
      return NextResponse.json({ error: `Falha no upload de "${file.name}": ${upErr.message}` }, { status: 500 });
    }
    novos.push({ id: docId, nome: file.name, path, tamanho: file.size, enviado_em: new Date().toISOString() });
  }

  const atualizados = [...docs, ...novos];
  const { error: dbErr } = await supabaseAdmin.from("veiculos").update({ documentos: atualizados }).eq("id", id);
  if (dbErr) {
    await supabaseAdmin.storage.from(BUCKET).remove(novos.map((n) => n.path)).catch(() => {});
    return NextResponse.json({ error: "Falha ao salvar no banco" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, adicionados: novos.length });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await requireVehicleOwner(id);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const docId = (body as { docId?: string }).docId;
  if (!docId) return NextResponse.json({ error: "docId obrigatório" }, { status: 400 });

  const { data: veic } = await supabaseAdmin
    .from("veiculos")
    .select("documentos")
    .eq("id", id)
    .single();
  const docs = lerDocs(veic?.documentos);
  const alvo = docs.find((d) => d.id === docId);
  if (!alvo) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  await supabaseAdmin.storage.from(BUCKET).remove([alvo.path]).catch(() => {});
  const restantes = docs.filter((d) => d.id !== docId);
  await supabaseAdmin.from("veiculos").update({ documentos: restantes }).eq("id", id);

  return NextResponse.json({ ok: true });
}
