// GET /vitrine/[tenant]/verificacao-google/[arquivo] — servido como
// /google<código>.html no domínio próprio da loja (o proxy reescreve pra cá).
// Só responde arquivo cadastrado em lib/verificacao-google.ts.

import { arquivoGoogleValido } from "@/lib/verificacao-google";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string; arquivo: string }> }) {
  const { tenant, arquivo } = await params;
  if (!arquivoGoogleValido(tenant, arquivo)) return new Response("Not found", { status: 404 });
  return new Response(`google-site-verification: ${arquivo}`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
