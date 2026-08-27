import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { logEventoAdmin } from "@/lib/admin-eventos";

const dataBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { user_id, acao, valor } = await req.json();
  if (!user_id || !acao) return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });

  let update: Record<string, any> = {};
  // Evento pra timeline do tenant (admin_eventos) — logado após o update dar certo.
  let evento: { tipo: string; descricao: string; meta?: Record<string, unknown> } | null = null;

  switch (acao) {
    case "mudar_plano": {
      // Muda o plano e garante que está ativo por pelo menos 30 dias
      // (config_garage pode ter múltiplas linhas por user_id — pega a mais recente)
      const { data: planoRows } = await supabaseAdmin
        .from("config_garage")
        .select("plano_ativo, plano_vence_em")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const planoAtual = planoRows?.[0];
      const venceEm = planoAtual?.plano_vence_em && new Date(planoAtual.plano_vence_em) > new Date()
        ? planoAtual.plano_vence_em
        : new Date(Date.now() + 30 * 86400000).toISOString();
      update = { plano: valor, plano_ativo: true, plano_vence_em: venceEm };
      evento = { tipo: "mudar_plano", descricao: `Plano alterado para ${valor}`, meta: { plano: valor } };
      break;
    }

    case "ativar": {
      // FIX +30d: renovar adiantado não pode roubar dias — estende a partir do
      // MAIOR entre agora e o vencimento atual (antes era sempre agora + 30d).
      const { data: cfgRows } = await supabaseAdmin
        .from("config_garage")
        .select("plano_vence_em")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const venceAtual = cfgRows?.[0]?.plano_vence_em;
      const base = venceAtual && new Date(venceAtual) > new Date()
        ? new Date(venceAtual).getTime()
        : Date.now();
      const novoVence = new Date(base + 30 * 86400000).toISOString();
      update = { plano_ativo: true, plano_vence_em: novoVence };
      evento = {
        tipo: "ativar",
        descricao: `Plano ativado por +30 dias (vence em ${dataBR(novoVence)})`,
        meta: { plano_vence_em: novoVence },
      };
      break;
    }

    case "demo":
      // Conta de demonstração/teste: acesso total, nunca expira e FORA do financeiro.
      // plano='demo' é excluído de MRR, contas a receber e régua de cobrança.
      update = {
        plano: "demo",
        plano_ativo: true,
        plano_vence_em: "2099-01-01T00:00:00.000Z",
        cobranca_automatica: false,
      };
      break;

    case "desativar":
      update = { plano_ativo: false };
      evento = { tipo: "desativar", descricao: "Plano desativado" };
      break;

    case "bloquear":
      update = { bloqueado: true, plano_ativo: false };
      evento = { tipo: "bloquear", descricao: "Conta bloqueada" };
      break;

    case "desbloquear":
      update = { bloqueado: false };
      evento = { tipo: "desbloquear", descricao: "Conta desbloqueada" };
      break;

    case "estender_trial": {
      // valor = número de dias extras
      // Estende o vencimento ATIVO: se o cliente está em trial, estende trial_ends_at.
      // Se já está em plano pago (plano_ativo = true), estende plano_vence_em.
      // Resolve o bug em que clicar +30d num cliente Premium não fazia nada visível.
      const dias = parseInt(valor) || 7;
      const { data: atualRows } = await supabaseAdmin
        .from("config_garage")
        .select("trial_ends_at, plano_ativo, plano_vence_em")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const atual = atualRows?.[0];

      // Cliente em plano pago ativo → estende plano_vence_em
      if (atual?.plano_ativo) {
        const baseP = atual?.plano_vence_em && new Date(atual.plano_vence_em) > new Date()
          ? new Date(atual.plano_vence_em)
          : new Date();
        baseP.setDate(baseP.getDate() + dias);
        update = { plano_vence_em: baseP.toISOString(), plano_ativo: true };
        evento = {
          tipo: "estender_trial",
          descricao: `Plano estendido em ${dias} dias (vence em ${dataBR(baseP.toISOString())})`,
          meta: { dias, plano_vence_em: baseP.toISOString() },
        };
      } else {
        // Cliente em trial (ou expirado sem plano) → estende trial_ends_at
        const baseT = atual?.trial_ends_at && new Date(atual.trial_ends_at) > new Date()
          ? new Date(atual.trial_ends_at)
          : new Date();
        baseT.setDate(baseT.getDate() + dias);
        update = { trial_ends_at: baseT.toISOString() };
        evento = {
          tipo: "estender_trial",
          descricao: `Trial estendido em ${dias} dias (até ${dataBR(baseT.toISOString())})`,
          meta: { dias, trial_ends_at: baseT.toISOString() },
        };
      }
      break;
    }

    case "set_vencimento":
      // valor = data ISO
      update = { plano_ativo: true, plano_vence_em: valor };
      evento = {
        tipo: "set_vencimento",
        descricao: `Vencimento definido para ${dataBR(valor)}`,
        meta: { plano_vence_em: valor },
      };
      break;

    case "set_desconto": {
      // valor = desconto negociado em R$/mês (0 = sem desconto, valor de tabela)
      const desconto = Math.max(0, Math.round(Number(valor) || 0));
      update = { plano_desconto: desconto };
      evento = {
        tipo: "set_desconto",
        descricao: desconto > 0
          ? `Desconto negociado definido: R$ ${desconto}/mês`
          : "Desconto negociado removido (valor de tabela)",
        meta: { plano_desconto: desconto },
      };
      break;
    }

    case "set_cobranca_automatica": {
      // valor = "true"/"false" — opt-in da régua de avisos de vencimento
      const ligado = valor === true || valor === "true";
      update = { cobranca_automatica: ligado };
      evento = {
        tipo: "set_cobranca_automatica",
        descricao: ligado ? "Cobrança automática ativada" : "Cobrança automática desativada",
        meta: { cobranca_automatica: ligado },
      };
      break;
    }

    case "set_suspensao_automatica": {
      // valor = "true"/"false" — opt-in da suspensão após 5 dias de atraso
      const ligado = valor === true || valor === "true";
      update = { suspensao_automatica: ligado };
      evento = {
        tipo: "set_suspensao_automatica",
        descricao: ligado ? "Suspensão automática ativada" : "Suspensão automática desativada",
        meta: { suspensao_automatica: ligado },
      };
      break;
    }

    case "set_whatsapp_financeiro": {
      // valor = dígitos do WhatsApp do financeiro ("" limpa → null)
      const digitos = String(valor ?? "").replace(/\D/g, "");
      update = { whatsapp_financeiro: digitos || null };
      evento = {
        tipo: "set_whatsapp_financeiro",
        descricao: digitos
          ? `WhatsApp financeiro definido: ${digitos}`
          : "WhatsApp financeiro removido",
        meta: { whatsapp_financeiro: digitos || null },
      };
      break;
    }

    case "set_indicado_por": {
      // valor = código de indicação do indicador (vazio = limpar)
      const code = String(valor ?? "").trim().toUpperCase();
      if (!code) { update = { indicado_por: null }; break; }
      const { data: ref } = await supabaseAdmin
        .from("config_garage")
        .select("user_id")
        .eq("codigo_indicacao", code)
        .maybeSingle();
      if (!ref || ref.user_id === user_id) {
        return NextResponse.json({ error: "Código de indicação inválido" }, { status: 400 });
      }
      update = { indicado_por: ref.user_id };
      break;
    }

    case "set_avisa":
      // valor = { avisa_base_url, avisa_token }
      if (!valor?.avisa_base_url && !valor?.avisa_token) {
        return NextResponse.json({ error: "avisa_base_url ou avisa_token obrigatório" }, { status: 400 });
      }
      update = {};
      if (valor.avisa_base_url) update.avisa_base_url = String(valor.avisa_base_url).trim();
      if (valor.avisa_token)    update.avisa_token    = String(valor.avisa_token).trim();
      break;

    case "set_meta":
      // valor = { meta_phone_id, meta_access_token, whatsapp_agente? }
      if (!valor || (!valor.meta_phone_id && !valor.meta_access_token)) {
        return NextResponse.json({ error: "meta_phone_id ou meta_access_token obrigatório" }, { status: 400 });
      }
      update = {};
      // trim obrigatório: telefone colado com TAB/espaço nas pontas grava sujo e
      // quebra em silêncio quem compara o campo cru (ver whatsapp_agente).
      if (valor.meta_phone_id)     update.meta_phone_id     = String(valor.meta_phone_id).trim();
      if (valor.meta_access_token) update.meta_access_token = String(valor.meta_access_token).trim();
      if (valor.whatsapp_agente)   update.whatsapp_agente   = String(valor.whatsapp_agente).trim();
      break;

    default:
      return NextResponse.json({ error: "Ação desconhecida" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("config_garage")
    .update(update)
    .eq("user_id", user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (evento) await logEventoAdmin(user_id, evento.tipo, evento.descricao, evento.meta);

  return NextResponse.json({ ok: true });
}
