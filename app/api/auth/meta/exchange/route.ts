import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = getEffectiveUserId(user!);

  try {
    const { code, redirectUri, configId, appId: clientAppId } = await req.json();
    if (!code) return NextResponse.json({ error: "code obrigatório" }, { status: 400 });

    const appId     = process.env.META_APP_ID!;
    const appSecret = process.env.META_APP_SECRET!;

    // O code é emitido PELO app do browser. Se o browser usa um app e o servidor
    // troca com outro, a Meta recusa com 100/36008 (mensagem enganosa de redirect_uri).
    if (clientAppId && clientAppId !== appId) {
      console.error(`🚨 [Meta exchange] app_id divergente: browser=${clientAppId} servidor=${appId}`);
      return NextResponse.json({
        error: `App do Facebook divergente: o botão usou o app ${clientAppId} e o servidor troca com o app ${appId}. Alinhe NEXT_PUBLIC_META_APP_ID e META_APP_ID na Vercel e redeploy.`,
      }, { status: 400 });
    }
    if (!configId) {
      console.error("🚨 [Meta exchange] code veio SEM config_id — fluxo caiu no Login clássico");
      return NextResponse.json({
        error: "O login do Facebook rodou sem config_id (Embedded Signup). O código gerado não é de Login for Business e não pode ser trocado. Configure NEXT_PUBLIC_META_CONFIG_ID e redeploy.",
      }, { status: 400 });
    }

    // O FB.login (JS SDK) usa o canal interno do FB (staticxx/xd_arbiter) como
    // redirect_uri no diálogo — NÃO a nossa URL. Por isso a troca é SEM
    // redirect_uri e nenhuma URL nossa jamais "bate": quando o 36008 aparece, a
    // causa está no code (não é de Login for Business), nunca no redirect.
    console.log(`🔍 [Meta exchange] server_app_id=${appId} client_app_id=${clientAppId ?? "?"} config_id=${configId ?? "AUSENTE"} secret_len=${appSecret?.length ?? 0} code_len=${code?.length ?? 0} redirectUri=${JSON.stringify(redirectUri ?? null)}`);

    // (o check client_credentials de 05/08 já confirmou que o par app_id+secret é
    // válido — removido pra não logar app token à toa.)

    // Troca do code pelo access token — SEM redirect_uri (Embedded Signup /
    // Login for Business, jeito documentado). O code é validado contra o app
    // (client_id+secret), não contra um redirect_uri da nossa origem.
    const tokenRes = await fetch(
      "https://graph.facebook.com/v23.0/oauth/access_token?" +
      new URLSearchParams({ client_id: appId, client_secret: appSecret, code }),
    );
    const tokenData = await tokenRes.json();
    console.log(`🔍 [Meta exchange] tokenData=${JSON.stringify(tokenData).slice(0, 500)}`);
    if (!tokenData.access_token) {
      // 36008 aqui, com app_id/secret/config_id já validados acima, significa que o
      // code não é de Login for Business: a configuração do config_id não é do tipo
      // Embedded Signup, ou não pertence a este app.
      if (tokenData?.error?.error_subcode === 36008) {
        throw new Error(
          "A Meta recusou o código (36008). App e secret conferem, então a configuração " +
          `${configId} provavelmente não é uma config de Embedded Signup (Facebook Login for Business) ` +
          `do app ${appId}. Confira em Login do Facebook para Empresas → Configurações.`,
        );
      }
      throw new Error("Token inválido: " + JSON.stringify(tokenData));
    }

    let accessToken = tokenData.access_token;

    // Troca por token de longa duração (~60 dias) — o token do code do Embedded
    // Signup é curto; sem isso a conexão do tenant expira sozinha em 1-2h.
    // Best-effort: se falhar (alguns tokens de negócio já vêm long-lived), mantém o original.
    try {
      const llRes = await fetch(
        "https://graph.facebook.com/v23.0/oauth/access_token?" +
        new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: accessToken,
        }),
      );
      const llData = await llRes.json();
      if (llData.access_token) accessToken = llData.access_token;
      else console.warn("⚠️ [Meta exchange] long-lived token não retornado:", JSON.stringify(llData).slice(0, 200));
    } catch (e) {
      console.warn("⚠️ [Meta exchange] falha no long-lived exchange:", String(e).slice(0, 200));
    }

    // Busca WABA e phone
    const wabaRes  = await fetch(
      `https://graph.facebook.com/v23.0/me/businesses?access_token=${accessToken}&fields=id,name,whatsapp_business_accounts`,
    );
    const wabaData = await wabaRes.json();
    const waba     = wabaData?.data?.[0]?.whatsapp_business_accounts?.data?.[0];
    const wabaId   = waba?.id ?? null;

    let phoneNumberId: string | null = null;
    if (wabaId) {
      const phoneRes  = await fetch(`https://graph.facebook.com/v23.0/${wabaId}/phone_numbers?access_token=${accessToken}`);
      const phoneData = await phoneRes.json();
      phoneNumberId   = phoneData?.data?.[0]?.id ?? null;
    }

    // ── subscribed_apps: assina o app no WABA do tenant ──────────────────────────
    // CRÍTICO: sem isso, mensagens recebidas nesse WABA NUNCA chegam no webhook
    // /api/webhook/meta — o agente fica mudo. Best-effort com log ruidoso.
    if (wabaId) {
      try {
        const subRes = await fetch(`https://graph.facebook.com/v23.0/${wabaId}/subscribed_apps`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const subData = await subRes.json();
        if (subData?.success) console.log(`✅ [Meta exchange] WABA ${wabaId} assinado no app (subscribed_apps)`);
        else console.error(`🚨 [Meta exchange] subscribed_apps FALHOU (inbound não vai chegar):`, JSON.stringify(subData).slice(0, 300));
      } catch (e) {
        console.error("🚨 [Meta exchange] erro no subscribed_apps:", String(e).slice(0, 200));
      }
    }

    // ── register: ativa o número pra enviar via Cloud API ────────────────────────
    // Best-effort: números já ativados pelo Embedded Signup retornam "already
    // registered" (ok). PIN de 6 dígitos só é exigido se o número tiver 2FA sem PIN
    // conhecido — nesse caso loga e segue (o envio pode falhar até registrar manual).
    if (phoneNumberId) {
      try {
        const regRes = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ messaging_product: "whatsapp", pin: "000000" }),
        });
        const regData = await regRes.json();
        if (regData?.success) console.log(`✅ [Meta exchange] número ${phoneNumberId} registrado`);
        else console.warn(`ℹ️ [Meta exchange] register não confirmado (pode já estar ativo):`, JSON.stringify(regData).slice(0, 300));
      } catch (e) {
        console.warn("ℹ️ [Meta exchange] erro no register (número pode já estar ativo):", String(e).slice(0, 200));
      }
    }

    // Salva no tenant
    await supabaseAdmin
      .from("config_garage")
      .update({
        meta_access_token: accessToken,
        meta_phone_id:     phoneNumberId,
        meta_waba_id:      wabaId,
      })
      .eq("user_id", userId);

    return NextResponse.json({
      access_token:    accessToken,
      phone_number_id: phoneNumberId,
      waba_id:         wabaId,
    });
  } catch (err: any) {
    console.error("Meta exchange error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
