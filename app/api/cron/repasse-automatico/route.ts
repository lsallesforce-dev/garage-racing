// app/api/cron/repasse-automatico/route.ts
//
// Cron job de repasse automático — envia um carro por vez para o grupo de repasse
// de cada tenant que tiver repasse_auto_ativo=true no config_garage.
//
// Rodízio: veículos são ordenados por repasse_enviado_em ASC NULLS FIRST, garantindo
// que o carro há mais tempo sem ser enviado (ou nunca enviado) seja o próximo.
//
// Controles por tenant:
//   · repasse_auto_ativo        — liga/desliga o cron para o tenant
//   · repasse_grupo_jid         — JID do grupo Avisa (ex: "1203...@g.us")
//   · repasse_intervalo_min     — intervalo mínimo em minutos entre envios (default 120)
//   · repasse_janela_inicio     — hora início da janela (default 8, inclusive)
//   · repasse_janela_fim        — hora fim da janela (default 18, exclusive)
//   · avisa_base_url/avisa_token — credenciais Avisa (obrigatórias)
//
// Critérios do próximo carro:
//   · status_venda = "DISPONIVEL"
//   · preco_sugerido > 0
//   · pertence ao tenant (user_id)
//   · menor repasse_enviado_em (ou null, que vem primeiro)
//
// Após envio bem-sucedido: atualiza veiculos.repasse_enviado_em = now().

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage, sendAvisaImage, sendAvisaPreview } from "@/lib/avisa";
import { gerarRepasseCompleto, gerarTextoBomDia } from "@/lib/repasse";
import { chaveDataBRT } from "@/lib/frases-motivacionais";

export const maxDuration = 120;

// ─── Autenticação (idêntica ao padrão de app/api/cron/followup/route.ts) ──────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    // CRON_SECRET configurado → exige o Bearer token que o Vercel envia automaticamente
    return req.headers.get("authorization") === `Bearer ${secret}`;
  }

  // CRON_SECRET não configurado:
  // – em dev: libera tudo
  // – em produção: NEGA (fail-closed). NÃO confia no User-Agent "vercel-cron/1.0"
  //   porque qualquer um pode forjar esse header e disparar o cron.
  if (process.env.NODE_ENV !== "production") return true;
  return false;
}

// ─── GET Handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agora = new Date();

  // Hora atual em Brasília (numérico, 0–23)
  const horaBRT = parseInt(
    agora.toLocaleString("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }),
    10,
  );

  // Sábado tem janela de fim própria (lojas costumam fechar ao meio-dia)
  const ehSabado =
    agora.toLocaleString("en-US", { weekday: "short", timeZone: "America/Sao_Paulo" }) === "Sat";

  // ── 1. Busca tenants elegíveis ────────────────────────────────────────────
  // config_garage: repasse_auto_ativo=true, repasse_grupo_jid preenchido,
  //                avisa_base_url e avisa_token preenchidos
  const { data: configRows, error: configErr } = await supabaseAdmin
    .from("config_garage")
    .select(
      `user_id, avisa_base_url, avisa_token,
       repasse_grupo_jid, repasse_auto_ativo,
       repasse_intervalo_min, repasse_janela_inicio, repasse_janela_fim,
       repasse_janela_fim_sabado, repasse_qtd_por_envio,
       repasse_bomdia_ativo, repasse_bomdia_enviado_em,
       repasse_link_comunidade, repasse_link_instagram,
       nome_fantasia, nome_empresa, logo_url`,
    )
    .eq("repasse_auto_ativo", true)
    .not("repasse_grupo_jid", "is", null)
    .not("avisa_base_url", "is", null)
    .not("avisa_token", "is", null)
    .order("created_at", { ascending: false });

  if (configErr) {
    console.error("❌ repasse-automatico: erro ao buscar config_garage:", configErr);
    return NextResponse.json({ error: configErr.message }, { status: 500 });
  }

  if (!configRows || configRows.length === 0) {
    console.log("📊 repasse-automatico: nenhum tenant com repasse automático ativo");
    return NextResponse.json({ processados: 0, enviados: 0 });
  }

  // Para tenants com múltiplas linhas em config_garage, usa só a mais recente
  // (já ordenado por created_at DESC, então o primeiro por user_id é o mais recente)
  const tenantConfigMap = new Map<string, (typeof configRows)[0]>();
  for (const row of configRows) {
    if (!tenantConfigMap.has(row.user_id)) {
      tenantConfigMap.set(row.user_id, row);
    }
  }

  const tenants = Array.from(tenantConfigMap.values());

  let processados = 0;
  let enviados = 0;

  for (const cfg of tenants) {
    processados++;
    const tenantId = cfg.user_id;

    try {
      // ── 2. Gate de janela horária ─────────────────────────────────────────
      const janelaBRT = horaBRT;
      const inicio: number = cfg.repasse_janela_inicio ?? 8;
      const fim: number = ehSabado
        ? (cfg.repasse_janela_fim_sabado ?? 12)
        : (cfg.repasse_janela_fim ?? 18);

      if (janelaBRT < inicio || janelaBRT >= fim) {
        console.log(
          `⏰ [repasse/${tenantId}] Fora da janela (${janelaBRT}h BRT, janela ${inicio}h–${fim}h) — pulando`,
        );
        continue;
      }

      // ── 2b. "Bom dia" diário — 1x por dia (calendário BRT), assim que a janela abre ─
      if (cfg.repasse_bomdia_ativo ?? true) {
        const hojeBRT = chaveDataBRT(agora);
        const ultimoBomDiaBRT = cfg.repasse_bomdia_enviado_em ? chaveDataBRT(new Date(cfg.repasse_bomdia_enviado_em)) : null;

        if (ultimoBomDiaBRT !== hojeBRT) {
          const textoBomDia = gerarTextoBomDia(cfg.repasse_link_comunidade, cfg.repasse_link_instagram, agora);
          const avisaCredsBomDia = { baseUrl: cfg.avisa_base_url as string, token: cfg.avisa_token as string };

          // Card de metadado (ícone + nome da loja + "Convite para comunidade") no link
          // do grupo — Baileys/Avisa não busca isso sozinho, precisa vir explícito. A
          // Avisa EXIGE imagem no payload do /actions/sendPreview (400 sem ela) — sem
          // logo cadastrada em Configurações, cai pro texto simples (sem card).
          let logoBase64: string | undefined;
          if (cfg.repasse_link_comunidade && cfg.logo_url) {
            try {
              const r = await fetch(cfg.logo_url as string);
              if (r.ok) logoBase64 = Buffer.from(await r.arrayBuffer()).toString("base64");
            } catch (e) {
              console.warn(`⚠️ [repasse/${tenantId}] Falha ao baixar logo pro preview do bom dia:`, e);
            }
          }

          if (cfg.repasse_link_comunidade && logoBase64) {
            await sendAvisaPreview(
              cfg.repasse_grupo_jid as string,
              textoBomDia,
              cfg.repasse_link_comunidade as string,
              (cfg.nome_fantasia || cfg.nome_empresa || "Comunidade") as string,
              "Convite para comunidade",
              logoBase64,
              avisaCredsBomDia,
            );
          } else {
            await sendAvisaMessage(cfg.repasse_grupo_jid as string, textoBomDia, avisaCredsBomDia, { typing: false });
          }
          await supabaseAdmin
            .from("config_garage")
            .update({ repasse_bomdia_enviado_em: agora.toISOString() })
            .eq("user_id", tenantId);
          console.log(`☀️ [repasse/${tenantId}] Bom dia enviado para o grupo ${cfg.repasse_grupo_jid}`);
          await new Promise((r) => setTimeout(r, 4000));
        }
      }

      // ── 3. Checar intervalo desde o último envio ──────────────────────────
      const intervaloMin: number = cfg.repasse_intervalo_min ?? 120;

      const { data: ultimoEnvioRows } = await supabaseAdmin
        .from("veiculos")
        .select("repasse_enviado_em")
        .eq("user_id", tenantId)
        .not("repasse_enviado_em", "is", null)
        .order("repasse_enviado_em", { ascending: false })
        .limit(1);

      const ultimoEnvio = ultimoEnvioRows?.[0]?.repasse_enviado_em ?? null;

      if (ultimoEnvio) {
        const diffMs = agora.getTime() - new Date(ultimoEnvio).getTime();
        const diffMin = diffMs / 60_000;
        if (diffMin < intervaloMin) {
          console.log(
            `⏱️ [repasse/${tenantId}] Último envio há ${diffMin.toFixed(0)}min (intervalo mínimo: ${intervaloMin}min) — pulando`,
          );
          continue;
        }
      }

      // ── 4. Próximos carros do rodízio (1–N por envio, conforme config) ─────
      const qtdPorEnvio = Math.min(Math.max(cfg.repasse_qtd_por_envio ?? 1, 1), 5);
      const { data: carros } = await supabaseAdmin
        .from("veiculos")
        .select("id")
        .eq("user_id", tenantId)
        .eq("status_venda", "DISPONIVEL")
        .gt("preco_sugerido", 0)
        .order("repasse_enviado_em", { ascending: true, nullsFirst: true })
        .limit(qtdPorEnvio);

      if (!carros || carros.length === 0) {
        console.log(`🚗 [repasse/${tenantId}] Sem carros disponíveis com preço — pulando`);
        continue;
      }

      const grupoJid: string = cfg.repasse_grupo_jid as string;
      const avisaCreds = {
        baseUrl: cfg.avisa_base_url as string,
        token: cfg.avisa_token as string,
      };

      for (let i = 0; i < carros.length; i++) {
        const veiculoId: string = carros[i].id;

        // ── 5. Gerar conteúdo do repasse ────────────────────────────────────
        console.log(`🔄 [repasse/${tenantId}] Gerando repasse ${i + 1}/${carros.length} para veículo ${veiculoId}...`);

        const resultado = await gerarRepasseCompleto(veiculoId, "repasse");

        if (!resultado) {
          console.warn(`⚠️ [repasse/${tenantId}] gerarRepasseCompleto retornou null para ${veiculoId} — pulando carro`);
          continue;
        }

        const { texto, capaUrl } = resultado;

        // Pausa entre anúncios consecutivos — evita burst e mantém ordem no grupo
        if (i > 0) await new Promise((r) => setTimeout(r, 4000));

        // ── 6. Enviar para o grupo via Avisa — imagem + legenda juntas ──────
        // sendAvisaImage manda a foto como base64 COM width/height (lê a dimensão
        // real) → o WhatsApp não corta a prévia. Foto + texto numa mensagem só.
        if (capaUrl && String(capaUrl).startsWith("http")) {
          await sendAvisaImage(grupoJid, capaUrl, texto, avisaCreds);
        } else {
          await sendAvisaMessage(grupoJid, texto, avisaCreds, { typing: false });
        }

        // ── 7. Atualiza repasse_enviado_em do carro (só após envio sem throw) ─
        await supabaseAdmin
          .from("veiculos")
          .update({ repasse_enviado_em: agora.toISOString() })
          .eq("id", veiculoId);

        enviados++;
        console.log(
          `✅ [repasse/${tenantId}] Enviado veículo ${veiculoId} para grupo ${grupoJid}`,
        );
      }
    } catch (e) {
      // Erro em um tenant não derruba os outros
      console.error(`❌ [repasse/${tenantId}] Erro ao processar tenant:`, e);
    }
  }

  console.log(`📊 repasse-automatico: ${enviados} enviados de ${processados} tenants processados`);
  return NextResponse.json({ processados, enviados });
}
