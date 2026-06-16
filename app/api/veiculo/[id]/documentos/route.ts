// app/api/veiculo/[id]/documentos/route.ts
//
// Documentos arquivados do veículo (PDFs sensíveis: CRLV, laudo, etc.).
// Os arquivos ficam num bucket PRIVADO (documentos-veiculos) — acesso sempre
// por signed URL gerada no servidor, nunca por URL pública. No banco só
// guardamos metadados em veiculos.documentos (jsonb).
//
// Upload é DIRETO do navegador pro Supabase Storage (signed upload URL):
// o corpo do PDF NÃO passa pela função da Vercel — isso evita o limite rígido
// de ~4.5MB do body de serverless (que dava HTTP 413). O limite real passa a
// ser o do bucket (10MB).
//
//   GET    → lista os docs com signed URL de download (1h)
//   POST   → { nome, tamanho } → cria signed UPLOAD url { docId, path, token }
//   PUT    → { docId, nome, tamanho } → grava o metadado após o upload
//   DELETE → { docId } → remove storage + metadado

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { randomUUID } from "crypto";

const BUCKET = "documentos-veiculos";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — igual ao limite do bucket
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const { data: veic } = await supabaseAdmin.from("veiculos").select("documentos").eq("id", id).single();
  const docs = lerDocs(veic?.documentos);

  const comUrl = await Promise.all(
    docs.map(async (d) => {
      const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(d.path, 3600);
      return { id: d.id, nome: d.nome, tamanho: d.tamanho, enviado_em: d.enviado_em, url: signed?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ documentos: comUrl });
}

// Passo 1 do upload: gera uma signed upload URL pro navegador enviar direto ao Storage.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireVehicleOwner(id);
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const body = await req.json().catch(() => ({}));
  const nome = String((body as { nome?: string }).nome ?? "").trim();
  const tamanho = Number((body as { tamanho?: number }).tamanho ?? 0);

  if (!nome.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Só aceitamos arquivos PDF." }, { status: 400 });
  }
  if (!(tamanho > 0) || tamanho > MAX_BYTES) {
    return NextResponse.json({ error: "PDF inválido ou maior que 10 MB." }, { status: 400 });
  }

  const docId = randomUUID();
  const path = `${userId}/${id}/${docId}.pdf`;
  const { data, error: signErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signErr || !data) {
    return NextResponse.json({ error: "Falha ao preparar o upload." }, { status: 500 });
  }

  return NextResponse.json({ docId, path: data.path, token: data.token });
}

// Passo 2 do upload: o navegador já subiu o PDF — grava o metadado no banco.
// O path é RECONSTRUÍDO no servidor (userId+id+docId) — nunca confiamos no
// path do cliente, evitando gravar metadado apontando pra arquivo de outro tenant.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireVehicleOwner(id);
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const body = await req.json().catch(() => ({}));
  const docId = String((body as { docId?: string }).docId ?? "");
  const nome = String((body as { nome?: string }).nome ?? "").trim();
  const tamanho = Number((body as { tamanho?: number }).tamanho ?? 0);

  if (!UUID_RE.test(docId)) return NextResponse.json({ error: "docId inválido" }, { status: 400 });
  if (!nome) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });

  const path = `${userId}/${id}/${docId}.pdf`;

  // Confirma que o objeto realmente subiu antes de gravar o metadado
  const { data: lista } = await supabaseAdmin.storage.from(BUCKET).list(`${userId}/${id}`, { search: `${docId}.pdf` });
  if (!lista?.some((o) => o.name === `${docId}.pdf`)) {
    return NextResponse.json({ error: "Arquivo não encontrado no storage — upload não concluído." }, { status: 400 });
  }

  const { data: veic } = await supabaseAdmin.from("veiculos").select("documentos").eq("id", id).single();
  const docs = lerDocs(veic?.documentos);
  if (docs.some((d) => d.id === docId)) {
    return NextResponse.json({ ok: true }); // idempotente
  }

  const novo: DocMeta = { id: docId, nome, path, tamanho, enviado_em: new Date().toISOString() };
  const { error: dbErr } = await supabaseAdmin.from("veiculos").update({ documentos: [...docs, novo] }).eq("id", id);
  if (dbErr) {
    await supabaseAdmin.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: "Falha ao salvar no banco" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await requireVehicleOwner(id);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const docId = (body as { docId?: string }).docId;
  if (!docId) return NextResponse.json({ error: "docId obrigatório" }, { status: 400 });

  const { data: veic } = await supabaseAdmin.from("veiculos").select("documentos").eq("id", id).single();
  const docs = lerDocs(veic?.documentos);
  const alvo = docs.find((d) => d.id === docId);
  if (!alvo) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  await supabaseAdmin.storage.from(BUCKET).remove([alvo.path]).catch(() => {});
  const restantes = docs.filter((d) => d.id !== docId);
  await supabaseAdmin.from("veiculos").update({ documentos: restantes }).eq("id", id);

  return NextResponse.json({ ok: true });
}
