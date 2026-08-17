// app/api/cron/transmissao-envios/route.ts
//
// Cron da feature "Prospecção" do tenant (nome interno: TRANSMISSÃO): dá vazão
// à fila de transmissao_envios, 1-a-1, numa instância Avisa DEDICADA por tenant
// (config_garage.transmissao_avisa_base_url/token — NUNCA a instância do agente IA).
//
// Anti-ban (lições: soft-ban 463 da Mari + BLOCK do chip do Marcos em 15/07,
// que caiu com 152 envios/dia após 3 dias a 50/dia, em fluxo contínuo ~120/h):
//   · tick a cada 2min (vercel.json), janela horária BRT por tenant:
//     [transmissao_janela_inicio, transmissao_janela_fim), com offset aleatório
//     estável no dia pro 1º envio (nunca começar em rajada na hora cravada)
//   · cap diário = min(config, TETO_SISTEMA_DIA, média 7d × 1,3 + 10, ramp-up)
//     — o crescimento gradual também é o re-warm-up automático pós-ban
//   · cap HORÁRIO (CAP_HORA) + ~25% dos ticks descansam aleatoriamente
//   · máx 4 envios por tick + jitter 8–33s antes do 1º e 20–45s entre envios
//   · 3 falhas (não-validate) consecutivas → pausa + alerta (possível 463)
//   · BAN_STREAK erros "validate" SEGUIDOS = chip bloqueado (não número ruim):
//     pausa, alerta e DEVOLVE os contatos do streak pra fila
//
// Corrida entre ticks: claim atômico por envio (pendente → enviando com
// WHERE status='pendente'); se o UPDATE não retornar linha, outro tick pegou.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage, sendAvisaImage } from "@/lib/avisa";
import { montarMensagemEnvio } from "@/lib/transmissao";
import { chaveDataBRT } from "@/lib/frases-motivacionais";
import { outboundLiberado } from "@/lib/assinatura";
import { alertaInterno } from "@/lib/alerta-interno";

export const maxDuration = 300;

const MAX_ENVIOS_POR_TICK = 4;
const RAMP_UP_DIAS = 7;
const RAMP_UP_CAP = 50;
const MAX_FALHAS_CONSECUTIVAS = 3;
// ── Travas anti-ban (block do chip do Marcos em 15/07: 152 envios num dia,
//    após 3 dias a 50/dia, em fluxo contínuo de ~120/h → banido às 11:40) ─────
const TETO_SISTEMA_DIA = 100; // teto ABSOLUTO por chip/dia — ignora config maior
const CAP_HORA = 15;          // espalha o dia inteiro; mata o burst de ~120/h
const BAN_STREAK = 4;         // N erros "validate" SEGUIDOS = chip bloqueado (não número ruim)
const CHANCE_DESCANSO = 0.25; // % de ticks pulados aleatoriamente (ritmo humano)

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
  // Cai pra e-mail se a instância interna estiver fora — alerta de chip banido
  // é exatamente o que não pode se perder.
  await alertaInterno("transmissao-envios", "Alerta da transmissão", texto);
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
  const minutoBRT = parseInt(
    agora.toLocaleString("pt-BR", { minute: "numeric", timeZone: "America/Sao_Paulo" }),
    10,
  );

  // ── 1. Tenants elegíveis: pacote habilitado + instância Avisa dedicada ──────
  const { data: configRows, error: configErr } = await supabaseAdmin
    .from("config_garage")
    .select(
      `user_id, transmissao_avisa_base_url, transmissao_avisa_token,
       transmissao_cap_dia, transmissao_janela_inicio, transmissao_janela_fim,
       transmissao_ativada_em,
       plano_ativo, plano_vence_em, trial_ends_at, bloqueado`,
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
      // ── Gate de assinatura (fail-closed) ──────────────────────────────────
      // Serviço pausado (plano_ativo=false) ou bloqueado → não dispara. Volta
      // sozinho ao reativar o plano, sem mexer no transmissao_habilitada.
      if (!outboundLiberado(cfg, agora)) {
        console.log(`🔒 [transmissao/${tenantId}] Assinatura inativa — pulando`);
        continue;
      }

      // ── 2a. Janela horária BRT ────────────────────────────────────────────
      const inicio: number = cfg.transmissao_janela_inicio ?? 8;
      const fim: number = cfg.transmissao_janela_fim ?? 18;
      if (horaBRT < inicio || horaBRT >= fim) {
        console.log(
          `⏰ [transmissao/${tenantId}] Fora da janela (${horaBRT}h BRT, janela ${inicio}h–${fim}h) — pulando`,
        );
        continue;
      }

      // Offset aleatório (estável no dia, por tenant) pro início da janela:
      // nunca começar a disparar na hora cravada, todo dia igual (o padrão
      // "08:00:31 em rajada" era assinatura robótica — block de 15/07).
      const seedDia = (chaveDataBRT(agora) + tenantId)
        .split("")
        .reduce((a, c) => a + c.charCodeAt(0), 0);
      const offsetMin = seedDia % 40;
      if (horaBRT === inicio && minutoBRT < offsetMin) {
        console.log(
          `⏰ [transmissao/${tenantId}] Aguardando offset do dia (${minutoBRT}min < ${offsetMin}min) — pulando`,
        );
        continue;
      }

      // Descanso aleatório: ~25% dos ticks não enviam nada — quebra o ritmo
      // metronômico de 1 msg a cada ~30s por 40min seguidos.
      if (Math.random() < CHANCE_DESCANSO) {
        console.log(`☕ [transmissao/${tenantId}] Tick de descanso aleatório — pulando`);
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

      // Crescimento gradual: no máx ~30% acima da média dos últimos 7 dias.
      // O block de 15/07 veio de saltar 50/dia → 152 num dia (cap subiu 50→300
      // no meio do dia). Também é o re-warm-up automático pós-ban: dias parados
      // derrubam a média e o volume volta devagar sozinho.
      const seteDiasAtras = new Date(meiaNoiteBRT.getTime() - 7 * 24 * 60 * 60 * 1000);
      const { count: enviados7dCount } = await supabaseAdmin
        .from("transmissao_envios")
        .select("*", { count: "exact", head: true })
        .eq("user_id", tenantId)
        .eq("status", "enviado")
        .gte("enviado_em", seteDiasAtras.toISOString())
        .lt("enviado_em", meiaNoiteBRT.toISOString());
      const capCrescimento = Math.ceil(((enviados7dCount ?? 0) / 7) * 1.3) + 10;

      const capEfetivo = Math.min(
        capBase,
        TETO_SISTEMA_DIA,
        capCrescimento,
        emRampUp ? RAMP_UP_CAP : Infinity,
      );

      if (enviadosHoje >= capEfetivo) {
        console.log(
          `🧢 [transmissao/${tenantId}] Cap diário atingido (${enviadosHoje}/${capEfetivo} = min[config ${capBase}, teto ${TETO_SISTEMA_DIA}, crescimento ${capCrescimento}${emRampUp ? `, ramp-up ${RAMP_UP_CAP}` : ""}]) — pulando`,
        );
        continue;
      }

      // Cap HORÁRIO: nada de rajada — no block de 15/07 o chip caiu mandando
      // ~120/h em fluxo contínuo. 15/h espalha o cap do dia pelo dia inteiro.
      const umaHoraAtras = new Date(agora.getTime() - 60 * 60_000).toISOString();
      const { count: enviadosHoraCount } = await supabaseAdmin
        .from("transmissao_envios")
        .select("*", { count: "exact", head: true })
        .eq("user_id", tenantId)
        .eq("status", "enviado")
        .gte("enviado_em", umaHoraAtras);
      const enviadosHora = enviadosHoraCount ?? 0;
      if (enviadosHora >= CAP_HORA) {
        console.log(
          `🕐 [transmissao/${tenantId}] Cap horário atingido (${enviadosHora}/${CAP_HORA} na última hora) — descansando`,
        );
        continue;
      }

      // ── 2c. Campanha ativa mais antiga ────────────────────────────────────
      const { data: campRows } = await supabaseAdmin
        .from("transmissao_campanhas")
        .select("id, texto, capa_url, veiculo_id")
        .eq("user_id", tenantId)
        .eq("status", "ativa")
        .order("criado_em", { ascending: true })
        .limit(1);
      const campanha = campRows?.[0] ?? null;
      if (!campanha) continue; // sem campanha ativa → skip silencioso

      // ── 2c-bis. Veículo vendido ou removido → cancela a campanha ───────────
      // O anúncio não pode continuar saindo pra um carro que saiu do estoque.
      // Confere status_venda; se não achar o veículo (deletado) ou não estiver
      // DISPONIVEL (vendido/reservado), cancela e pula — evita ter que cancelar
      // na mão (pedido Marcos Repasse).
      const { data: veicRows } = await supabaseAdmin
        .from("veiculos")
        .select("status_venda")
        .eq("id", campanha.veiculo_id)
        .eq("user_id", tenantId)
        .limit(1);
      const veic = veicRows?.[0] ?? null;
      if (!veic || veic.status_venda !== "DISPONIVEL") {
        await supabaseAdmin
          .from("transmissao_campanhas")
          .update({ status: "cancelada" })
          .eq("id", campanha.id)
          .eq("user_id", tenantId);
        console.log(
          `🚫 [transmissao/${tenantId}] Campanha ${campanha.id} cancelada — veículo ${!veic ? "removido" : `status ${veic.status_venda}`}`,
        );
        continue;
      }

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

      const limite = Math.min(
        MAX_ENVIOS_POR_TICK,
        capEfetivo - enviadosHoje,
        CAP_HORA - enviadosHora,
      );
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

      // ── Detector de ban: semente do streak de erros "validate" ─────────────
      // Quando o chip é BLOQUEADO, a Avisa devolve "Could not validate the
      // provided number" pra TODO envio — igualzinho a número inexistente. Um
      // streak de BAN_STREAK seguidos é estatisticamente impossível numa lista
      // normal (no block de 15/07 foram 31 seguidos; o cron martelou o chip
      // morto por 15min porque o breaker ignorava esse erro). O streak precisa
      // atravessar ticks (cada tick manda só 4) — então semeia do banco.
      const { data: ultimosFinalizados } = await supabaseAdmin
        .from("transmissao_envios")
        .select("id, status, erro")
        .eq("campanha_id", campanha.id)
        .in("status", ["enviado", "erro"])
        .order("claimed_em", { ascending: false, nullsFirst: false })
        .limit(BAN_STREAK);
      let validateStreakIds: string[] = [];
      for (const u of ultimosFinalizados ?? []) {
        if (u.status === "erro" && /validate/i.test(u.erro ?? "")) validateStreakIds.push(u.id);
        else break;
      }

      const creds = {
        baseUrl: cfg.transmissao_avisa_base_url as string,
        token: cfg.transmissao_avisa_token as string,
      };

      // ── 2e/2f. Envio 1-a-1: claim atômico + jitter anti-robô ──────────────
      let falhasConsecutivas = 0;
      for (let i = 0; i < pendentes.length; i++) {
        const envio = pendentes[i];

        // Jitter entre envios — cadência humana, nunca burst (lição do 463).
        // TAMBÉM antes do 1º envio do tick: sem isso, tick sobreposto ao
        // anterior colava envios com 1–2s de gap (visto no block de 15/07).
        const jitterMs = i === 0 ? 8000 + Math.random() * 17000 : 20000 + Math.random() * 25000;
        await new Promise((r) => setTimeout(r, jitterMs));

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
          validateStreakIds = [];
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
          if (ehNumeroInvalido) {
            validateStreakIds.push(envio.id);
          } else {
            falhasConsecutivas++;
            validateStreakIds = [];
          }
          console.warn(
            `⚠️ [transmissao/${tenantId}] Falha no envio para ${contato.telefone}: ${motivo}${ehNumeroInvalido ? ` (erro de validação — ${validateStreakIds.length} seguido(s))` : ` (${falhasConsecutivas} consecutiva(s))`}`,
          );

          // Detector de BAN: BAN_STREAK erros "validate" seguidos = chip
          // bloqueado, não número ruim. Os contatos do streak NUNCA receberam —
          // voltam pra fila em vez de morrer como "erro" (no block de 15/07,
          // 31 contatos foram queimados assim). Pausa e alerta.
          if (validateStreakIds.length >= BAN_STREAK) {
            await supabaseAdmin
              .from("transmissao_envios")
              .update({ status: "pendente", claimed_em: null, erro: null })
              .in("id", validateStreakIds);
            await supabaseAdmin
              .from("transmissao_campanhas")
              .update({ status: "pausada" })
              .eq("id", campanha.id)
              .eq("user_id", tenantId);
            await alertarGerente(
              `🚨 Chip de PROSPECÇÃO provavelmente BLOQUEADO (${validateStreakIds.length} erros de validação seguidos). Campanha pausada e contatos devolvidos pra fila. Deixar o chip em SILÊNCIO 24–48h antes de reativar. Tenant ${tenantId}`,
            );
            console.error(
              `🛑 [transmissao/${tenantId}] Campanha ${campanha.id} pausada — provável BAN do chip (${validateStreakIds.length} erros de validação seguidos; contatos re-enfileirados)`,
            );
            break;
          }

          // Circuit breaker clássico: 3 falhas (não-validate) seguidas = problema
          // no chip/instância — insistir só piora. Pausa a campanha e avisa.
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
