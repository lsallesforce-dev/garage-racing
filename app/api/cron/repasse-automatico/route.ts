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
import { sendAvisaMessage, sendAvisaImage } from "@/lib/avisa";
import { gerarRepasseCompleto, gerarTextoBomDia, gruposDoConfig } from "@/lib/repasse";
import { chaveDataBRT } from "@/lib/frases-motivacionais";

// 300s (era 120): com múltiplos grupos + retries de Avisa lenta, o tick das
// 17:10 de 08/07 estourou os 120s no MEIO dos envios → morreu antes de marcar
// repasse_enviado_em → o retry automático da Vercel re-enviou o carro (3x no grupo).
export const maxDuration = 300;

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
  // config_garage: repasse_auto_ativo=true + avisa preenchida. O(s) grupo(s) de
  // destino vêm de repasse_grupos (jsonb, migration 021) com fallback pro
  // repasse_grupo_jid legado — resolvidos por gruposDoConfig() no loop.
  const CAMPOS_BASE = `user_id, avisa_base_url, avisa_token,
       repasse_grupo_jid, repasse_grupo_nome, repasse_auto_ativo,
       repasse_intervalo_min, repasse_janela_inicio, repasse_janela_fim,
       repasse_janela_fim_sabado, repasse_qtd_por_envio,
       repasse_bomdia_ativo, repasse_bomdia_enviado_em,
       repasse_link_comunidade, repasse_link_instagram, repasse_bomdia_logo_url,
       nome_fantasia, nome_empresa`;

  // any[]: o shape muda entre o select com/sem as colunas novas (fallback abaixo)
  let { data: configRows, error: configErr }: { data: any[] | null; error: { message?: string } | null } =
    await supabaseAdmin
      .from("config_garage")
      .select(`${CAMPOS_BASE}, repasse_grupos, repasse_ciclo_iniciado_em`)
      .eq("repasse_auto_ativo", true)
      .not("avisa_base_url", "is", null)
      .not("avisa_token", "is", null)
      .order("created_at", { ascending: false });

  // Janela deploy→migration (021/022): se alguma coluna nova ainda não existe,
  // refaz sem elas — grupo cai pro legado e o rodízio cai pra ordem antiga; o
  // repasse NÃO para (cron quente de produção, cliente real no ar).
  if (configErr && /repasse_grupos|repasse_ciclo_iniciado_em/i.test(configErr.message ?? "")) {
    console.warn("⚠️ repasse-automatico: coluna nova ausente (migration 021/022 pendente) — usando modo legado");
    ({ data: configRows, error: configErr } = await supabaseAdmin
      .from("config_garage")
      .select(CAMPOS_BASE)
      .eq("repasse_auto_ativo", true)
      .not("avisa_base_url", "is", null)
      .not("avisa_token", "is", null)
      .order("created_at", { ascending: false }));
  }

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
      // ── 2. Grupos de destino + gate de janela horária ─────────────────────
      const grupos = gruposDoConfig(cfg);
      if (grupos.length === 0) {
        console.log(`👥 [repasse/${tenantId}] Nenhum grupo vinculado — pulando`);
        continue;
      }

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

          // Formato igual ao das comunidades (ex.: Marcos Repasse): a logo vai como
          // IMAGEM real (grande) + o texto do bom dia como legenda — via /actions/sendImage.
          // (sendPreview gera só um card pequeno de link e é instável; sendImage replica
          // o visual que o cliente quer.) O card cinza "Convite para comunidade" do link
          // é gerado nativamente pelo WhatsApp p/ links chat.whatsapp.com. Sem logo
          // dedicada (repasse_bomdia_logo_url) cai pro texto simples.
          for (let gi = 0; gi < grupos.length; gi++) {
            if (gi > 0) await new Promise((r) => setTimeout(r, 4000)); // pausa entre grupos
            const grupo = grupos[gi];
            if (cfg.repasse_bomdia_logo_url) {
              // sendAvisaImage baixa a URL do nosso storage e manda base64 + dimensão real.
              await sendAvisaImage(grupo.jid, cfg.repasse_bomdia_logo_url as string, textoBomDia, avisaCredsBomDia);
            } else {
              await sendAvisaMessage(grupo.jid, textoBomDia, avisaCredsBomDia, { typing: false });
            }
            console.log(`☀️ [repasse/${tenantId}] Bom dia enviado para o grupo ${grupo.nome ?? grupo.jid}`);
          }
          await supabaseAdmin
            .from("config_garage")
            .update({ repasse_bomdia_enviado_em: agora.toISOString() })
            .eq("user_id", tenantId);
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
        // Tolerância p/ o jitter do cron: este cron roda a cada 10min (*/10), mas o
        // tick nunca cai no segundo exato do último envio — chega ~alguns segundos
        // "antes" dos Nmin cheios (ex.: último envio 12:00:06, tick 12:10:01 → diff
        // 9,9min). Sem a folga, `9,9 < 10` pulava o tick e o intervalo de 10min do
        // usuário virava 20min na prática (pulava 1 tick sempre). 2min absorve o
        // jitter sem transformar em spam (mínimo efetivo = intervalo - 2).
        const TOLERANCIA_CRON_MIN = 2;
        if (diffMin < intervaloMin - TOLERANCIA_CRON_MIN) {
          console.log(
            `⏱️ [repasse/${tenantId}] Último envio há ${diffMin.toFixed(0)}min (intervalo mínimo: ${intervaloMin}min) — pulando`,
          );
          continue;
        }
      }

      // ── 4. Próximos carros do rodízio — ORDEM DETERMINÍSTICA ──────────────
      // Fluxo previsível/controlável (página "Fluxo Grupo"): o carro há mais
      // tempo sem sair vai primeiro (repasse_enviado_em ASC NULLS FIRST); os
      // PAUSADOS (repasse_pausado=true) ficam de fora até o dono despausar. A
      // ordem fixa deixa a agenda 100% previsível — lib/repasse-agenda calcula
      // exatamente o mesmo horário que aparece no board. (Substitui o sorteio
      // por ciclo de 09/07: agora a variação vem do Pausar manual, não do random.)
      const qtdPorEnvio = Math.min(Math.max(cfg.repasse_qtd_por_envio ?? 1, 1), 5);
      const { data: fila } = await supabaseAdmin
        .from("veiculos")
        .select("id, repasse_enviado_em") // repasse_enviado_em: trava otimista do claim
        .eq("user_id", tenantId)
        .eq("status_venda", "DISPONIVEL")
        .gt("preco_sugerido", 0)
        .eq("repasse_pausado", false)
        .order("repasse_enviado_em", { ascending: true, nullsFirst: true })
        .limit(qtdPorEnvio);
      const carros = fila ?? [];

      if (carros.length === 0) {
        console.log(`🚗 [repasse/${tenantId}] Sem carros no fluxo (todos pausados/vendidos/sem preço) — pulando`);
        continue;
      }

      const avisaCreds = {
        baseUrl: cfg.avisa_base_url as string,
        token: cfg.avisa_token as string,
      };

      for (let i = 0; i < carros.length; i++) {
        const veiculoId: string = carros[i].id;
        const priorEnvio: string | null = carros[i].repasse_enviado_em ?? null;

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

        // ── 6. CLAIM ATÔMICO antes de enviar + enviar para TODOS os grupos ──
        // repasse_enviado_em é gravado ANTES dos envios (claim do slot): se a
        // função morrer no meio (timeout/redeploy) e a Vercel re-executar o cron,
        // ou se a Avisa responder 504 ambíguo (entregou mas sem confirmação), o
        // carro JAMAIS é re-enviado — duplicata num grupo de 1.800 membros é bem
        // pior que um carro pular uma volta do rodízio (incidente do Uno 3x, 08/07).
        //
        // TRAVA OTIMISTA contra 2 invocações CONCORRENTES do cron (retry/overlap
        // de deploy pegando o mesmo carro → duplicata, incidente S10 13/07): o
        // UPDATE só casa se o repasse_enviado_em ainda for o valor que este tick
        // leu (priorEnvio). A 1ª invocação grava agora e muda o valor; a 2ª não
        // acha mais a linha (0 rows) → NÃO envia. (marcar incondicional só barrava
        // re-invocação SEQUENCIAL, não corrida simultânea.)
        const claimBase = supabaseAdmin
          .from("veiculos")
          .update({ repasse_enviado_em: agora.toISOString() })
          .eq("id", veiculoId)
          .eq("user_id", tenantId);
        const claimQ = priorEnvio == null
          ? claimBase.is("repasse_enviado_em", null)
          : claimBase.eq("repasse_enviado_em", priorEnvio);
        const { data: claimed } = await claimQ.select("id");
        if (!claimed || claimed.length === 0) {
          console.log(
            `⏭️ [repasse/${tenantId}] Veículo ${veiculoId} já enviado por outro tick concorrente — pulando (anti-duplicata)`,
          );
          continue;
        }

        // sendAvisaImage manda a foto como base64 COM width/height (lê a dimensão
        // real) → o WhatsApp não corta a prévia. Foto + texto numa mensagem só.
        let algumOk = false;
        for (let gi = 0; gi < grupos.length; gi++) {
          if (gi > 0) await new Promise((r) => setTimeout(r, 4000)); // pausa entre grupos
          const grupo = grupos[gi];
          let ok: boolean;
          if (capaUrl && String(capaUrl).startsWith("http")) {
            const resultado = await sendAvisaImage(grupo.jid, capaUrl, texto, avisaCreds);
            ok = resultado != null;
          } else {
            ok = await sendAvisaMessage(grupo.jid, texto, avisaCreds, { typing: false });
          }
          if (ok) algumOk = true;
          console.log(
            ok
              ? `✅ [repasse/${tenantId}] Enviado veículo ${veiculoId} para grupo ${grupo.nome ?? grupo.jid}`
              : `⚠️ [repasse/${tenantId}] FALHA (ou entrega não confirmada) do veículo ${veiculoId} no grupo ${grupo.nome ?? grupo.jid}`,
          );
        }

        if (algumOk) enviados++;
      }
    } catch (e) {
      // Erro em um tenant não derruba os outros
      console.error(`❌ [repasse/${tenantId}] Erro ao processar tenant:`, e);
    }
  }

  console.log(`📊 repasse-automatico: ${enviados} enviados de ${processados} tenants processados`);
  return NextResponse.json({ processados, enviados });
}
