// app/api/assumir/route.ts
//
// Link enviado ao gerente via WhatsApp no alerta de lead quente.
// Um toque faz tudo:
//   1. Para a IA (em_atendimento_humano = true)
//   2. Abre o WhatsApp direto na conversa com o cliente (sem passar por página web)

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const waId  = searchParams.get("wa_id");
  const uid   = searchParams.get("uid");   // user_id direto (Meta)
  const token = searchParams.get("token"); // webhook_token legado (Avisa)

  if (!waId) return new NextResponse("wa_id obrigatório", { status: 400 });
  if (!uid && !token) return new NextResponse("Identificação obrigatória", { status: 401 });

  let tenantUserId: string | null = uid ?? null;

  // Legado: resolve user_id pelo webhook_token
  if (!tenantUserId && token) {
    const { data: cfg } = await supabaseAdmin
      .from("config_garage")
      .select("user_id")
      .eq("webhook_token", token)
      .maybeSingle();
    if (!cfg) return new NextResponse("Token inválido", { status: 403 });
    tenantUserId = cfg.user_id;
  }

  // Para a IA apenas para leads deste tenant
  await supabaseAdmin
    .from("leads")
    .update({ em_atendimento_humano: true })
    .eq("wa_id", waId)
    .eq("user_id", tenantUserId);

  const phone = waId.replace(/\D/g, "");

  // Retorna HTML que abre o WhatsApp diretamente via deep link (whatsapp://)
  // sem passar pela página intermediária do wa.me
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Abrindo WhatsApp...</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f0fdf4; }
    .box { text-align: center; padding: 2rem; }
    p { color: #166534; font-size: 1rem; font-weight: 600; margin: 1rem 0 0; }
    small { color: #6b7280; font-size: 0.8rem; }
    a { display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.5rem; background: #25D366; color: white; border-radius: 999px; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <div class="box">
    <svg width="64" height="64" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.531 5.843L.057 23.571l5.88-1.473A11.944 11.944 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.001-1.371l-.358-.213-3.713.929.978-3.591-.234-.368A9.818 9.818 0 1112 21.818z"/></svg>
    <p>IA pausada. Abrindo conversa...</p>
    <small>Se não abrir automaticamente:</small><br>
    <a href="https://wa.me/${phone}">Abrir WhatsApp</a>
  </div>
  <script>
    // Tenta abrir direto no app via deep link
    window.location.href = "whatsapp://send?phone=${phone}";
    // Fallback após 1.5s: wa.me (caso deep link falhe no desktop)
    setTimeout(function() {
      window.location.href = "https://wa.me/${phone}";
    }, 1500);
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
