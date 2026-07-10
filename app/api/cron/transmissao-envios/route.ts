// app/api/cron/transmissao-envios/route.ts
//
// Cron da feature "Prospecção" do tenant (nome interno: TRANSMISSÃO): dá vazão
// à fila de transmissao_envios, 1-a-1, numa instância Avisa DEDICADA por tenant
// (config_garage.transmissao_avisa_base_url/token — NUNCA a instância do agente IA).
//
// Anti-ban (lição do soft-ban 463 do chip da Mari):
//   · janela horária BRT por tenant: [transmissao_janela_inicio, transmissao_janela_fim)
//   · cap diário (transmissao_cap_dia, default 150); RAMP-UP: chip com menos de
//     7 dias de ativação (transmissao_ativada_em null ou recente) → máx 50/dia
//   · máx 4 envios por tick + jitter 20–45s entre envios (cadência humana)
//   · saudação sorteada por contato (montarMensagemEnvio) quebra o fingerprint
//     de payload idêntico em massa
//   · 3 falhas consecutivas → pausa a campanha + alerta o gerente (possível 463)
//
// Corrida entre ticks: claim atômico por envio (pendente → enviando com
// WHERE status='pendente'); se o UPDATE não retornar linha, outro tick pegou.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage, sendAvisaImage } from "@/lib/avisa";
import { montarMensagemEnvio } from "@/lib/transmissao";
import { chaveDataBRT } from "@/lib/frases-motivacionais";

export const maxDuration = 300;

const MAX_ENVIOS_POR_TICK = 4;
const RAMP_UP_DIAS = 7;
const RAMP_UP_CAP = 50;
const MAX_FALHAS_CONSECUTIVAS = 3;

// ─── Autenticação (idêntica ao padrão de app/api/cron/repasse-automatico) ─────
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

// Alerta interno pro gerente da AutoZap (mesmo padrão do healthcheck-agentes):
// AUTOZAP_ALERT_WHATSAPP via instância Avisa interna AUTOZAP_AVISA_*.
async function alertarGerente(texto: string) {
  const alvo = process.env.AUTOZAP_ALERT_WHATSAPP;
  const baseUrl = process.env.AUTOZAP_AVISA_BASE_URL;
  const token = process.env.AUTOZAP_AVISA_TOKEN;
  if (!alvo || !baseUrl || !token) {
    console.warn("⚠️ [transmissao] AUTOZAP_ALERT_WHATSAPP/AUTOZAP_AVISA_* ausentes — alerta não enviado.");
    return;
  }
  try {
    await sendAvisaMessage(alvo, texto, { baseUrl, token }, { typing: false });
  } catch (err) {
    console.error("❌ [transmissao] falha ao enviar alerta interno:", err);
  }
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

  // ── 1. Tenants elegíveis: pacote habilitado + instância Avisa dedicada ──────
  const { data: configRows, error: configErr } = await supabaseAdmin
    .from("config_garage")
    .select(
      `user_id, transmissao_avisa_base_url, transmissao_avisa_token,
       transmissao_cap_dia, transmissao_janela_inicio, transmissao_janela_fim,
       transmissao_ativada_em`,
    )
    .eq("transmissao_habilitada", true)
    .not("transmissao_avisa_base_url", "is", null)
    .not("transmissao_avisa_token", "is", null)
    .order("created_at", { ascending: false });

  if (configErr) {
    console.error("❌ transmissao-envios: erro ao buscar config_garage:", configErr);
    return NextResponse.json({ error: configErr.message }, { status: 500 });
  }

  if (!configRows || configRows.length === 0) {
    console.log("📊 transmissao-envios: nenhum tenant com transmissão habilitada");
    return NextResponse.json({ processados: 0, enviados: 0, erros: 0 });
  }

  // Para tenants com múltiplas linhas em config_garage, usa só a mais recente
  // (já ordenado por created_at DESC, então o primeiro por user_id é o mais recente)
  const tenantConfigMap = new Map<string, (typeof configRows)[0]>();
  for (const row of configRows) {
    if (!tenantConfigMap.has(row.user_id)) {
      tenantConfigMap.set(row.user_id, row);
    }
  }

  let processados = 0;
  let enviados = 0;
  let erros = 0;

  for (const cfg of tenantConfigMap.values()) {
    processados++;
    const tenantId = cfg.user_id;

    try {
      // ── 2a. Janela horária BRT ────────────────────────────────────────────
      const inicio: number = cfg.transmissao_janela_inicio ?? 8;
      const fim: number = cfg.transmissao_janela_fim ?? 18;
      if (horaBRT < inicio || horaBRT >= fim) {
        console.log(
          `⏰ [transmissao/${tenantId}] Fora da janela (${horaBRT}h BRT, janela ${inicio}h–${fim}h) — pulando`,
        );
        continue;
      }

      // ── 2b. Cap diário (+ ramp-up de chip novo) ───────────────────────────
      // Meia-noite BRT de hoje em UTC: chaveDataBRT dá o dia calendário em
      // America/Sao_Paulo e o offset -03:00 fixa o instante certo.
      const meiaNoiteBRT = new Date(`${chaveDataBRT(agora)}T00:00:00-03:00`);
      const { count: enviadosHojeCount } = await supabaseAdmin
        .from("transmissao_envios")
        .select("*", { count: "exact", head: true })
        .eq("user_id", tenantId)
        .eq("status", "enviado")
        .gte("enviado_em", meiaNoiteBRT.toISOString());
      const enviadosHoje = enviadosHojeCount ?? 0;

      const capBase: number = cfg.transmissao_cap_dia ?? 150;
      const ativadaEm = cfg.transmissao_ativada_em ? new Date(cfg.transmissao_ativada_em) : null;
      const emRampUp =
        !ativadaEm || agora.getTime() - ativadaEm.getTime() < RAMP_UP_DIAS * 24 * 60 * 60 * 1000;
      const capEfetivo = emRampUp ? Math.min(capBase, RAMP_UP_CAP) : capBase;

      if (enviadosHoje >= capEfetivo) {
        console.log(
          `🧢 [transmissao/${tenantId}] Cap diário atingido (${enviadosHoje}/${capEfetivo}${emRampUp ? ", ramp-up chip novo" : ""}) — pulando`,
        );
        continue;
      }

      // ── 2c. Campanha ativa mais antiga ────────────────────────────────────
      const { data: campRows } = await supabaseAdmin
        .from("transmissao_campanhas")
        .select("id, texto, capa_url")
        .eq("user_id", tenantId)
        .eq("status", "ativa")
        .order("criado_em", { ascending: true })
        .limit(1);
      const campanha = campRows?.[0] ?? null;
      if (!campanha) continue; // sem campanha ativa → skip silencioso

      // ── 2d. Recupera presos + lote de pendentes ───────────────────────────
      // Envio preso em 'enviando' = lambda que morreu entre o claim e o update
      // final. >15min é maior que qualquer tick vivo (maxDuration 300s) → volta
      // pra fila. (Se o envio TINHA saído antes da morte, o contato recebe 2x —
      // raro e preferível a envio perdido pra sempre.)
      const cutoffPresos = new Date(agora.getTime() - 15 * 60_000).toISOString();
      await supabaseAdmin
        .from("transmissao_envios")
        .update({ status: "pendente", claimed_em: null })
        .eq("campanha_id", campanha.id)
        .eq("status", "enviando")
        .lt("claimed_em", cutoffPresos);

      const limite = Math.min(MAX_ENVIOS_POR_TICK, capEfetivo - enviadosHoje);
      const { data: pendentes } = await supabaseAdmin
        .from("transmissao_envios")
        .select("id, contato_id")
        .eq("campanha_id", campanha.id)
        .eq("status", "pendente")
        .limit(limite);

      if (!pendentes || pendentes.length === 0) {
        // Só conclui se também não há 'enviando' vivo (tick concorrente no meio
        // do último envio) — senão um preso recuperado depois ficaria órfão numa
        // campanha já 'concluida' que o cron nunca mais olha.
        const { count: enviandoCount } = await supabaseAdmin
          .from("transmissao_envios")
          .select("*", { count: "exact", head: true })
          .eq("campanha_id", campanha.id)
          .eq("status", "enviando");
        if ((enviandoCount ?? 0) === 0) {
          await supabaseAdmin
            .from("transmissao_campanhas")
            .update({ status: "concluida" })
            .eq("id", campanha.id)
            .eq("user_id", tenantId);
          console.log(`✅ [transmissao/${tenantId}] Campanha ${campanha.id} concluída — fila vazia`);
        } else {
          console.log(`⏳ [transmissao/${tenantId}] Campanha ${campanha.id} sem pendentes mas com ${enviandoCount} em envio — aguardando`);
        }
        continue;
      }

      const creds = {
        baseUrl: cfg.transmissao_avisa_base_url as string,
        token: cfg.transmissao_avisa_token as string,
      };

      // ── 2e/2f. Envio 1-a-1: claim atômico + jitter anti-robô ──────────────
      let falhasConsecutivas = 0;
      for (let i = 0; i < pendentes.length; i++) {
        const envio = pendentes[i];

        // Jitter 20–45s entre envios (exceto antes do primeiro) — cadência humana,
        // nunca burst (lição do 463)
        if (i > 0) await new Promise((r) => setTimeout(r, 20000 + Math.random() * 25000));

        // CLAIM ATÔMICO anti-corrida entre ticks: só processa se ainda estiver
        // pendente. UPDATE sem linha retornada = outro tick pegou primeiro.
        const { data: claimed } = await supabaseAdmin
          .from("transmissao_envios")
          .update({ status: "enviando", claimed_em: new Date().toISOString() })
          .eq("id", envio.id)
          .eq("status", "pendente")
          .select("id");
        if (!claimed || claimed.length === 0) {
          console.log(`⏭️ [transmissao/${tenantId}] Envio ${envio.id} já claimado por outro tick — pulando`);
          continue;
        }

        const { data: contatoRows } = await supabaseAdmin
          .from("transmissao_contatos")
          .select("nome, telefone")
          .eq("id", envio.contato_id)
          .eq("user_id", tenantId)
          .limit(1);
        const contato = contatoRows?.[0] ?? null;
        if (!contato) {
          // Dado inconsistente (não é falha da Avisa) — não conta pro circuit breaker
          await supabaseAdmin
            .from("transmissao_envios")
            .update({ status: "erro", erro: "contato não encontrado" })
            .eq("id", envio.id);
          erros++;
          console.warn(
            `⚠️ [transmissao/${tenantId}] Contato ${envio.contato_id} não encontrado — envio ${envio.id} marcado como erro`,
          );
          continue;
        }

        const msg = montarMensagemEnvio(contato.nome, campanha.texto);

        const errorRef: { message?: string } = {};
        let ok: boolean;
        if (campanha.capa_url && String(campanha.capa_url).startsWith("http")) {
          const resultado = await sendAvisaImage(contato.telefone, campanha.capa_url, msg, creds, errorRef);
          ok = resultado != null;
        } else {
          ok = await sendAvisaMessage(contato.telefone, msg, creds, { typing: false }, errorRef);
        }

        if (ok) {
          await supabaseAdmin
            .from("transmissao_envios")
            .update({ status: "enviado", enviado_em: new Date().toISOString() })
            .eq("id", envio.id);
          enviados++;
          falhasConsecutivas = 0;
          console.log(`📨 [transmissao/${tenantId}] Enviado para ${contato.telefone} (campanha ${campanha.id})`);
        } else {
          // Número inválido/não-WhatsApp é problema de DADO do contato, não sinal
          // de bloqueio do chip — não deve contar pro circuit breaker (senão uma
          // lista com vários números ruins seguidos pausa a campanha à toa).
          const motivo = errorRef.message || "falha no envio Avisa (motivo não identificado)";
          const ehNumeroInvalido = /validate|invalid.*number|n[uú]mero.*inv[aá]lido/i.test(motivo);
          await supabaseAdmin
            .from("transmissao_envios")
            .update({ status: "erro", erro: motivo })
            .eq("id", envio.id);
          erros++;
          if (!ehNumeroInvalido) falhasConsecutivas++;
          console.warn(
            `⚠️ [transmissao/${tenantId}] Falha no envio para ${contato.telefone}: ${motivo}${ehNumeroInvalido ? " (número inválido — não conta pro circuit breaker)" : ` (${falhasConsecutivas} consecutiva(s))`}`,
          );

          // Circuit breaker: 3 falhas seguidas = provável bloqueio do chip (463) —
          // insistir só piora o ban. Pausa a campanha e avisa o gerente.
          if (falhasConsecutivas >= MAX_FALHAS_CONSECUTIVAS) {
            await supabaseAdmin
              .from("transmissao_campanhas")
              .update({ status: "pausada" })
              .eq("id", campanha.id)
              .eq("user_id", tenantId);
            await alertarGerente(
              `🚨 Transmissão pausada automaticamente (3 falhas seguidas — possível bloqueio 463 do chip). Tenant ${tenantId}`,
            );
            console.error(
              `🛑 [transmissao/${tenantId}] Campanha ${campanha.id} pausada — ${MAX_FALHAS_CONSECUTIVAS} falhas consecutivas (possível 463)`,
            );
            break;
          }
        }
      }
    } catch (e) {
      // Erro em um tenant não derruba os outros
      console.error(`❌ [transmissao/${tenantId}] Erro ao processar tenant:`, e);
    }
  }

  console.log(
    `📊 transmissao-envios: ${enviados} enviados, ${erros} erros, ${processados} tenants processados`,
  );
  return NextResponse.json({ processados, enviados, erros });
}
