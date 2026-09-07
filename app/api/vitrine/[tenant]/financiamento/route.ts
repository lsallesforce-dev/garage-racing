import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveGaragem } from "@/lib/vitrine-tenant";
import { rateLimit } from "@/lib/redis";
import { sendAvisaMessage } from "@/lib/avisa";
import { sendMetaMessage } from "@/lib/meta";

// Rota PÚBLICA (vitrine do tenant, sem login). Recebe a ficha de crédito que o
// cliente preenche no lugar do antigo "simulador" — que dividia preço por
// parcelas e mostrava uma parcela sem juros, sempre bem menor que a real.
// Aqui não se calcula nada: grava a ficha e joga no WhatsApp do gerente, que
// leva pro banco.

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const txt = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Validação real de CPF (dígitos verificadores) — barra 111.111.111-11 e digitação errada. */
function cpfValido(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const peso of [10, 11]) {
    let soma = 0;
    for (let i = 0; i < peso - 1; i++) soma += Number(cpf[i]) * (peso - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(cpf[peso - 1])) return false;
  }
  return true;
}

/** Telefone BR em E.164 sem '+'. Devolve null se não parecer celular/fixo válido. */
function normalizaTelefone(raw: string): string | null {
  let d = so(raw);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return `55${d}`;
}

const VINCULOS: Record<string, string> = {
  clt: "CLT (carteira assinada)",
  autonomo: "Autônomo / MEI",
  empresario: "Empresário / sócio",
  servidor: "Servidor público",
  aposentado: "Aposentado / pensionista",
  outro: "Outro",
};

const ESTADO_CIVIL: Record<string, string> = {
  solteiro: "Solteiro(a)",
  casado: "Casado(a)",
  divorciado: "Divorciado(a)",
  viuvo: "Viúvo(a)",
  uniao: "União estável",
};

const RESTRICAO: Record<string, string> = {
  nao: "Sem restrição",
  sim: "TEM restrição no CPF",
  nao_sei: "Não sabe se tem restrição",
};

const fmtBRL = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await ctx.params;

  // Anti-spam: rota pública sem captcha. 5 fichas por IP por hora já cobre a
  // família inteira olhando o mesmo carro e mata o script.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "sem-ip";
  const rl = await rateLimit(`proposta-fin:${ip}`, 5, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo mais tarde." }, { status: 429 });
  }

  const garagem = await resolveGaragem(tenant);
  if (!garagem?.user_id) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const nome = txt(body.nome, 120);
  const cpf = so(body.cpf);
  const telefone = normalizaTelefone(body.telefone);

  if (nome.split(/\s+/).filter(Boolean).length < 2) {
    return NextResponse.json({ error: "Informe o nome completo." }, { status: 400 });
  }
  if (!cpfValido(cpf)) return NextResponse.json({ error: "CPF inválido." }, { status: 400 });
  if (!telefone) return NextResponse.json({ error: "WhatsApp inválido (DDD + número)." }, { status: 400 });

  const nascimento = /^\d{4}-\d{2}-\d{2}$/.test(String(body.nascimento ?? "")) ? String(body.nascimento) : null;

  const proposta = {
    tenant_user_id: garagem.user_id as string,
    veiculo_id: /^[0-9a-f-]{36}$/i.test(String(body.veiculoId ?? "")) ? String(body.veiculoId) : null,
    veiculo_desc: txt(body.veiculoDesc, 160) || null,
    preco: num(body.preco),
    nome,
    cpf,
    nascimento,
    nome_mae: txt(body.nomeMae, 120) || null,
    estado_civil: txt(body.estadoCivil, 20) || null,
    telefone,
    email: txt(body.email, 120) || null,
    cep: so(body.cep).slice(0, 8) || null,
    ocupacao: txt(body.ocupacao, 80) || null,
    vinculo: txt(body.vinculo, 20) || null,
    renda_mensal: num(body.rendaMensal),
    tempo_emprego: txt(body.tempoEmprego, 40) || null,
    entrada: num(body.entrada),
    prazo: Number.isFinite(Number(body.prazo)) ? Number(body.prazo) : null,
    restricao: txt(body.restricao, 10) || null,
    troca: txt(body.troca, 160) || null,
    observacao: txt(body.observacao, 500) || null,
    origem: "vitrine",
  };

  const { data: gravada, error: erroInsert } = await supabaseAdmin
    .from("propostas_financiamento")
    .insert(proposta)
    .select("id")
    .single();

  if (erroInsert) {
    console.error("🚨 [proposta-fin] falha ao gravar:", erroInsert.message);
    return NextResponse.json({ error: "Não consegui registrar sua ficha. Tente de novo." }, { status: 500 });
  }

  // ── Notificação do gerente ────────────────────────────────────────────────
  // Canal por tenant: Avisa se tiver credencial, senão Meta. Nunca misturar.
  const { data: cfg } = await supabaseAdmin
    .from("config_garage")
    .select("whatsapp, avisa_base_url, avisa_token, meta_phone_id, meta_access_token")
    .eq("user_id", garagem.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const c = cfg?.[0] as any;

  const gerente = so(c?.whatsapp ?? garagem.whatsapp).replace(/^(?!55)/, "55");
  const useAvisa = !!c?.avisa_base_url && !!c?.avisa_token;

  const linhas: (string | null)[] = [
    "🏦 *NOVA FICHA DE FINANCIAMENTO* (vitrine)",
    "",
    proposta.veiculo_desc
      ? `🚗 ${proposta.veiculo_desc}${proposta.preco ? ` — ${fmtBRL(proposta.preco)}` : ""}`
      : null,
    "",
    "*Cliente*",
    `👤 ${proposta.nome}`,
    `🆔 CPF ${cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}`,
    proposta.nascimento ? `🎂 ${proposta.nascimento.split("-").reverse().join("/")}` : null,
    proposta.nome_mae ? `👩 Mãe: ${proposta.nome_mae}` : null,
    proposta.estado_civil ? `💍 ${ESTADO_CIVIL[proposta.estado_civil] ?? proposta.estado_civil}` : null,
    `📱 ${telefone}`,
    proposta.email ? `✉️ ${proposta.email}` : null,
    proposta.cep ? `📍 CEP ${proposta.cep}` : null,
    "",
    "*Renda*",
    proposta.ocupacao ? `💼 ${proposta.ocupacao}` : null,
    proposta.vinculo ? `📄 ${VINCULOS[proposta.vinculo] ?? proposta.vinculo}` : null,
    proposta.renda_mensal ? `💰 Renda: ${fmtBRL(proposta.renda_mensal)}/mês` : null,
    proposta.tempo_emprego ? `⏳ Tempo: ${proposta.tempo_emprego}` : null,
    "",
    "*Condições pedidas*",
    `💵 Entrada: ${fmtBRL(proposta.entrada)}`,
    proposta.prazo ? `📅 Prazo: ${proposta.prazo}x` : null,
    proposta.restricao ? `⚠️ ${RESTRICAO[proposta.restricao] ?? proposta.restricao}` : null,
    proposta.troca ? `🔁 Troca: ${proposta.troca}` : null,
    proposta.observacao ? `📝 ${proposta.observacao}` : null,
    "",
    `🔗 https://wa.me/${telefone}`,
  ];

  const texto = linhas.filter((l): l is string => l !== null).join("\n");

  let entregue = false;
  let erroEnvio: string | null = null;
  if (gerente.length >= 12) {
    try {
      if (useAvisa) {
        const ref: { message?: string } = {};
        entregue = await sendAvisaMessage(
          gerente,
          texto,
          { baseUrl: c.avisa_base_url, token: c.avisa_token },
          { typing: false },
          ref
        );
        erroEnvio = entregue ? null : ref.message ?? "Avisa não confirmou o envio";
      } else if (c?.meta_phone_id && (c?.meta_access_token || process.env.META_ACCESS_TOKEN)) {
        const r = await sendMetaMessage(gerente, texto, {
          phoneNumberId: c.meta_phone_id,
          accessToken: c.meta_access_token || process.env.META_ACCESS_TOKEN || "",
        });
        entregue = r != null && r !== false;
        erroEnvio = entregue ? null : "Meta não confirmou o envio";
      } else {
        erroEnvio = "tenant sem canal WhatsApp configurado";
      }
    } catch (e: any) {
      erroEnvio = e?.message ?? "erro desconhecido no envio";
    }
  } else {
    erroEnvio = "config_garage.whatsapp (gerente) ausente ou inválido";
  }

  if (!entregue) console.error(`🚨 [proposta-fin ${gravada.id}] gerente NÃO notificado: ${erroEnvio}`);

  await supabaseAdmin
    .from("propostas_financiamento")
    .update({ notificado: entregue, erro_notificacao: erroEnvio })
    .eq("id", gravada.id);

  // A ficha está gravada: mesmo com o WhatsApp do gerente fora do ar o cliente
  // vê sucesso e o dado não se perde (erro_notificacao guarda o motivo).
  return NextResponse.json({ ok: true, id: gravada.id });
}
