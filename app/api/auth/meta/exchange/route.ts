import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { syncSmbAppData } from "@/lib/meta";

export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = getEffectiveUserId(user!);

  try {
    const {
      code, redirectUri, configId, codeAgeMs, finishRecebido, appId: clientAppId,
      // Assets que o FINISH do Embedded Signup entregou no browser. Não são
      // diagnóstico: são a fonte primária do WABA (ver bloco de descoberta abaixo).
      wabaId: clientWabaId, phoneNumberId: clientPhoneNumberId, coexistencia,
    } = await req.json();
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
    // codeFp identifica o code sem expô-lo: se dois requests trouxerem o MESMO fp, é
    // reenvio do mesmo code (o segundo sempre falha, code é de uso único).
    const codeFp = createHash("sha256").update(String(code)).digest("hex").slice(0, 10);
    console.log(`🔍 [Meta exchange] server_app_id=${appId} client_app_id=${clientAppId ?? "?"} config_id=${configId ?? "AUSENTE"} code_fp=${codeFp} code_age_ms=${codeAgeMs ?? "?"} finish=${finishRecebido ?? "?"} secret_len=${appSecret?.length ?? 0} code_len=${code?.length ?? 0} redirectUri=${JSON.stringify(redirectUri ?? null)}`);

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
        // O code do Embedded Signup é de uso único e vive ~30s. Idade alta = expirou
        // entre o fim do fluxo e o fechamento do popup (o callback do FB.login só
        // dispara quando o popup fecha).
        // Sem FINISH, o wizard do Embedded Signup nem rodou: o Facebook reaproveitou
        // a autorização existente e devolveu um code de reautorização, que não serve.
        if (finishRecebido === false) {
          throw new Error(
            "O fluxo do Embedded Signup não chegou ao fim — o Facebook reaproveitou uma autorização que essa conta já tinha e devolveu um código sem sessão de onboarding. " +
            "Remova o app AutoZap Digital em Facebook → Configurações → Apps e sites e conecte de novo.",
          );
        }
        if (typeof codeAgeMs === "number" && codeAgeMs > 25_000) {
          throw new Error(
            `O código expirou antes da troca (${Math.round(codeAgeMs / 1000)}s de vida; o limite da Meta é ~30s). ` +
            "Refaça a conexão e feche a janela do Facebook assim que o fluxo terminar.",
          );
        }
        throw new Error(
          `A Meta recusou o código (36008) com ${codeAgeMs ?? "?"}ms de idade. App, secret e a config ` +
          `${configId} já foram validados — se persistir, o code pode estar sendo reenviado (fp ${codeFp}).`,
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

    // ── Descoberta do WABA ───────────────────────────────────────────────────────
    // ORDEM IMPORTA. /me/businesses era a única fonte e é a ERRADA: ele lista os
    // businesses DO USUÁRIO, mas o token do Login for Business é escopado ao
    // business do CLIENTE — o usuário não "possui" aquele business, então a lista
    // volta vazia e o wabaId saía null. Sintoma: meta_waba_id NULL em 100% dos
    // tenants do banco, inclusive nos que têm token gravado.
    //
    // 1º) o waba_id que o próprio Embedded Signup entregou no FINISH. Na
    //     coexistência é o ÚNICO asset ID do payload — não há phone_number_id.
    // 2º) debug_token → granular_scopes: a Meta diz exatamente a quais WABAs este
    //     token dá acesso (target_ids de whatsapp_business_management).
    // 3º) /me/businesses como último recurso, pro caso do onboarding em que o
    //     tenant é dono do próprio business.
    let wabaId: string | null = clientWabaId ?? null;
    let origemWaba = wabaId ? "FINISH do Embedded Signup" : "";

    if (!wabaId) {
      try {
        const dbgRes = await fetch(
          "https://graph.facebook.com/v23.0/debug_token?" +
          new URLSearchParams({ input_token: accessToken, access_token: `${appId}|${appSecret}` }),
        );
        const dbgData = await dbgRes.json();
        const scopes: any[] = dbgData?.data?.granular_scopes ?? [];
        const mgmt = scopes.find((s) => s?.scope === "whatsapp_business_management")
                  ?? scopes.find((s) => s?.scope === "whatsapp_business_messaging");
        if (mgmt?.target_ids?.length) {
          wabaId = String(mgmt.target_ids[0]);
          origemWaba = "debug_token/granular_scopes";
        } else {
          console.warn("⚠️ [Meta exchange] debug_token sem target_ids de WhatsApp:", JSON.stringify(scopes).slice(0, 300));
        }
      } catch (e) {
        console.warn("⚠️ [Meta exchange] debug_token falhou:", String(e).slice(0, 200));
      }
    }

    if (!wabaId) {
      const wabaRes  = await fetch(
        `https://graph.facebook.com/v23.0/me/businesses?access_token=${accessToken}&fields=id,name,whatsapp_business_accounts`,
      );
      const wabaData = await wabaRes.json();
      wabaId = wabaData?.data?.[0]?.whatsapp_business_accounts?.data?.[0]?.id ?? null;
      if (wabaId) origemWaba = "/me/businesses";
    }

    if (!wabaId) {
      // Antes isso seguia calado e gravava null nas três colunas — a conexão
      // "dava certo" na tela e nascia morta no banco. Falhar alto.
      throw new Error(
        "A Meta autorizou o app mas não devolveu nenhuma WhatsApp Business Account. " +
        "Isso costuma ser Embedded Signup concluído sem selecionar/criar a conta, ou o app sem Advanced Access " +
        "em whatsapp_business_management (obrigatório pra onboardar negócio de terceiro).",
      );
    }
    console.log(`🔍 [Meta exchange] waba_id=${wabaId} (origem: ${origemWaba}) coexistencia=${coexistencia === true}`);

    // O phone_number_id do FINISH ganha do lookup: na coexistência o número já
    // existe e é o do celular do lojista. O lookup pega o [0] da lista, que pode
    // ser outro número do mesmo WABA.
    let phoneNumberId: string | null = clientPhoneNumberId ?? null;
    if (!phoneNumberId) {
      const phoneRes  = await fetch(`https://graph.facebook.com/v23.0/${wabaId}/phone_numbers?access_token=${accessToken}`);
      const phoneData = await phoneRes.json();
      phoneNumberId   = phoneData?.data?.[0]?.id ?? null;
      if (!phoneNumberId) console.warn(`⚠️ [Meta exchange] WABA ${wabaId} sem phone_numbers:`, JSON.stringify(phoneData).slice(0, 300));
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
    // NÃO roda na coexistência: o número já está registrado (ele vem do WhatsApp
    // Business App do lojista) e a doc manda pular explicitamente este passo
    // — "skip the phone number registration step, as the number is already
    // registered". Mandar /register com PIN 000000 num número que já tem 2FA do
    // dono é pedir pra falhar.
    //
    // Best-effort no caso normal: números já ativados pelo Embedded Signup retornam
    // "already registered" (ok). PIN de 6 dígitos só é exigido se o número tiver 2FA
    // sem PIN conhecido — nesse caso loga e segue.
    if (coexistencia === true) {
      console.log(`ℹ️ [Meta exchange] coexistência — /register pulado de propósito (número ${phoneNumberId} já registrado)`);

      // ── Sync do WhatsApp Business App: JANELA DE 24H ─────────────────────────
      // Sem isso o onboarding vence e o lojista tem que refazer o fluxo inteiro.
      // Roda AQUI, na sequência do onboarding, e não num cron: a Meta recomenda
      // disparar assim que o fluxo termina, e cada sync só vale UMA vez.
      //
      // Best-effort de propósito: a conexão em si já deu certo neste ponto (token
      // e WABA gravados logo abaixo). Se a sync falhar, o tenant fica conectado e
      // funcional daqui pra frente — perde só o histórico velho. Derrubar tudo por
      // causa disso seria pior.
      //
      // Sequencial, não Promise.all: são a mesma janela de rate limit do número e
      // a ordem importa pro suporte da Meta (contatos antes do histórico).
      if (phoneNumberId) {
        const credsSync = { phoneNumberId, accessToken };
        const contatos = await syncSmbAppData("smb_app_state_sync", credsSync);
        const historico = await syncSmbAppData("history", credsSync);
        if (!contatos.ok || !historico.ok) {
          console.error(
            `🚨 [Meta exchange] sync de coexistência incompleta (contatos=${contatos.ok ? "ok" : contatos.error}, ` +
            `historico=${historico.ok ? "ok" : historico.error}). A janela é de 24h — depois disso só refazendo o Embedded Signup.`,
          );
        }
      } else {
        console.error("🚨 [Meta exchange] coexistência sem phone_number_id — sync impossível, histórico será perdido");
      }
    } else if (phoneNumberId) {
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
