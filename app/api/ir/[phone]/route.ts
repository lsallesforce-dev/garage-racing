// app/api/ir/[phone]/route.ts
//
// URL curta para o gerente assumir um atendimento via WhatsApp.
// Exemplo: https://garage-racing.vercel.app/api/ir/5517991141010
//
// 1 toque → para a IA → abre WhatsApp direto na conversa com o cliente.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: { phone: string } }
) {
  const phone = params.phone.replace(/\D/g, "");

  if (!phone) {
    return new NextResponse("Número inválido", { status: 400 });
  }

  // Para a IA para este lead
  await supabaseAdmin
    .from("leads")
    .update({ em_atendimento_humano: true })
    .eq("wa_id", phone);

  // HTML que abre o WhatsApp diretamente via deep link
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Abrindo WhatsApp...</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f0fdf4; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 1.5rem; padding: 2.5rem 2rem; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.08); max-width: 320px; width: 90%; }
    .icon { width: 64px; height: 64px; margin: 0 auto 1.25rem; }
    h2 { font-size: 1.1rem; font-weight: 700; color: #111; margin-bottom: .5rem; }
    p { font-size: .85rem; color: #6b7280; margin-bottom: 1.5rem; }
    a { display: inline-flex; align-items: center; gap: .5rem; background: #25D366; color: white; text-decoration: none; font-weight: 700; font-size: .95rem; padding: .75rem 1.75rem; border-radius: 999px; }
  </style>
</head>
<body>
  <div class="card">
    <svg class="icon" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.531 5.843L.057 23.571l5.88-1.473A11.944 11.944 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.001-1.371l-.358-.213-3.713.929.978-3.591-.234-.368A9.818 9.818 0 1112 21.818z"/></svg>
    <h2>IA pausada ✓</h2>
    <p>Abrindo conversa com o cliente...</p>
    <a href="https://wa.me/${phone}">Abrir WhatsApp</a>
  </div>
  <script>
    window.location.href = "whatsapp://send?phone=${phone}";
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
