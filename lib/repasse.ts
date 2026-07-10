// lib/repasse.ts
//
// Lógica central de geração de repasse/promoção.
// Extraída de app/api/veiculo/gerar-repasse/route.ts para reuso
// no cron de repasse automático e na route original.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buscarFipe } from "@/lib/fipe";
import { fraseDoDia } from "@/lib/frases-motivacionais";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * Gera a mensagem diária de "Bom dia" do Repasse Automático em Comunidade:
 * frase motivacional do dia (rotativa, ver lib/frases-motivacionais.ts) +
 * convite pro grupo/comunidade + link do Instagram. Enviada 1x por dia,
 * antes do rodízio de carros começar (ver cron/repasse-automatico).
 */
export function gerarTextoBomDia(
  linkComunidade?: string | null,
  linkInstagram?: string | null,
  data: Date = new Date(),
): string {
  const diaSemana = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
  }).format(data).toUpperCase();
  const { frase, autor } = fraseDoDia(data);

  const linhas: string[] = [];
  linhas.push(`*BOM DIA A TODOS !*`);
  linhas.push(``);
  linhas.push(`*FRASE DO DIA:* "${frase}" - ${autor}`);
  linhas.push(``);
  linhas.push(`*ÓTIMA ${diaSemana} E BOAS VENDAS, BORA PRA CIMA !*`);

  if (linkComunidade) {
    linhas.push(``);
    linhas.push(`*Quer convidar um AMIGO ou LOJISTA? Compartilhe o link abaixo.*`);
    linhas.push(``);
    linhas.push(`*Clique aqui para entrar no grupo* 👇`);
    linhas.push(linkComunidade);
  }

  if (linkInstagram) {
    linhas.push(``);
    linhas.push(`*Siga-nos nas redes sociais apenas clicando no link abaixo!*`);
    linhas.push(``);
    linhas.push(`*Clique aqui para nos seguir no Instagram* 👇`);
    linhas.push(linkInstagram);
  }

  return linhas.join("\n");
}

export async function buscarMediaWeb(
  marca: string,
  modelo: string,
  versao: string,
  anoModelo: number,
): Promise<string | null> {
  try {
    const model = genAI.getGenerativeModel(
      { model: "gemini-2.5-flash", tools: [{ googleSearch: {} } as any] },
      { apiVersion: "v1beta" },
    );

    const query = `Qual a média de preço de venda na web (OLX, iCarros, Webmotors) de um ${marca} ${modelo} ${versao} ${anoModelo} no Brasil em ${new Date().getFullYear()}? Responda APENAS com JSON: {"mediaWeb": "R$ XX.XXX"}`;

    const result = await model.generateContent(query);
    const text = result.response.text();

    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.mediaWeb ?? null;
    }
  } catch (e) {
    console.warn("⚠️ Busca de média web falhou:", e);
  }
  return null;
}

export function formatarMoeda(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

export interface RepasseGrupo {
  jid: string;
  nome: string | null;
}

/**
 * Grupos de destino do repasse do tenant. Fonte da verdade: repasse_grupos
 * (jsonb, array de {jid, nome} — migration 021). Fallback: repasse_grupo_jid
 * legado (tenant que nunca re-salvou depois da migração). Dedup por jid e
 * só JIDs de grupo válidos (@g.us).
 */
export function gruposDoConfig(cfg: any): RepasseGrupo[] {
  const vistos = new Set<string>();
  const out: RepasseGrupo[] = [];

  const arr = Array.isArray(cfg?.repasse_grupos) ? cfg.repasse_grupos : [];
  for (const g of arr) {
    const jid = typeof g?.jid === "string" ? g.jid : "";
    if (!jid.endsWith("@g.us") || vistos.has(jid)) continue;
    vistos.add(jid);
    out.push({ jid, nome: typeof g?.nome === "string" ? g.nome : null });
  }

  const legacy = typeof cfg?.repasse_grupo_jid === "string" ? cfg.repasse_grupo_jid : "";
  if (out.length === 0 && legacy.endsWith("@g.us")) {
    out.push({ jid: legacy, nome: cfg?.repasse_grupo_nome ?? null });
  }

  return out;
}

// FIPE do anúncio: prioridade é o valor EXATO salvo no cadastro pela placa
// (apibrasil → veiculos.valor_fipe). Carro sem placa (cadastro por vídeo/manual)
// cai na busca textual da parallelum por marca/modelo/versão.
export async function resolverFipe(carro: any, versaoRica: string): Promise<string | null> {
  const valorBanco = Number(carro?.valor_fipe);
  if (Number.isFinite(valorBanco) && valorBanco > 0) {
    console.log(`📈 [FIPE] Usando valor_fipe do cadastro (placa): ${valorBanco}`);
    return formatarMoeda(valorBanco);
  }
  return buscarFipe(carro.marca, carro.modelo, versaoRica, carro.ano_modelo);
}

export function gerarTextoRepasse(
  carro: any,
  fipe: string | null,
  mediaWeb: string | null,
  botPhone?: string | null,
  tipo: "repasse" | "promocao" = "repasse",
  vitrineUrl?: string | null,
  cidadeTenant?: string | null,
): string {
  // Cidade do anúncio: prioridade pra cidade configurada do tenant
  // (config_garage.cidade). carro.local costuma vir como placeholder "PÁTIO" do
  // cadastro — só entra se o tenant não tiver cidade. "Interior" é o último recurso.
  const cidade = (cidadeTenant && cidadeTenant.trim()) || carro.local || "Interior";
  const cambio = carro.cambio || "";
  const anoFab = carro.ano_fabricacao || carro.ano_modelo || "";
  const anoMod = carro.ano_modelo || "";
  const km = carro.quilometragem_estimada
    ? new Intl.NumberFormat("pt-BR").format(carro.quilometragem_estimada)
    : "—";
  const preco = formatarMoeda(carro.preco_sugerido || 0);

  const linhas: string[] = [];

  // Título do anúncio: marca + modelo + versão + câmbio. Alguns carros têm o
  // cadastro de `versao` como quase-cópia de `modelo` (ex.: modelo="Frontier S
  // CD 4x4 2.3 TB Diesel Mec.", versao="S CD 4x4 2.3 TB Diesel Mec.") — sem essa
  // checagem o título saía com o mesmo texto duplicado. Só anexa a versão se
  // ela não estiver já contida no modelo (cobre o dado ruim sem exigir fix
  // manual em cada carro, e não muda nada nos carros com cadastro limpo, ex.:
  // versao="SR" nunca aparece dentro do modelo).
  const modeloUpper = (carro.modelo || "").toUpperCase();
  const versaoUpper = (carro.versao || "").toUpperCase().trim();
  const versaoParaTitulo = versaoUpper && !modeloUpper.includes(versaoUpper) ? carro.versao : "";

  linhas.push(`📍 ${cidade.toUpperCase()}`);
  linhas.push(``);
  linhas.push(
    `🚘 ${carro.marca?.toUpperCase()} ${carro.modelo?.toUpperCase()} ${versaoParaTitulo?.toUpperCase() || ""} ${cambio?.toUpperCase() || ""}`.trim(),
  );
  linhas.push(``);
  linhas.push(`🗓️ ${anoFab}/${anoMod}`);
  linhas.push(``);
  linhas.push(`⚙️ Km: ${km}`);
  linhas.push(``);

  if (mediaWeb) {
    linhas.push(`🛜 Média da Web: ${mediaWeb}`);
    linhas.push(``);
  }

  if (fipe) {
    linhas.push(`📈 Fipe: ${fipe}`);
    linhas.push(``);
  }

  linhas.push(`💵 Valor: ${preco}`);

  if (botPhone) {
    const phoneClean = botPhone.replace(/\D/g, "");
    // Link wa.me DIRETO — o WhatsApp abre a conversa do vendedor na hora, de dentro
    // do grupo. (O link curto /c/ ficava limpo porém NÃO abria: morria no navegador
    // interno do WhatsApp.) Prefill curto com o carro → o agente resolve via busca.
    const modeloCurto = String(carro.modelo || "").split(/\s+/).slice(0, 2).join(" ");
    const ctx = [carro.marca, modeloCurto, anoMod].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    // Prefill enxuto = só o carro (sem "Tenho interesse no") → link mais curto na
    // cara do anúncio. O agente resolve o carro pela busca do mesmo jeito.
    const prefill = encodeURIComponent(ctx).replace(/%20/g, "+");
    linhas.push(``);
    linhas.push(`💬 Falar com Vendedor:`);
    linhas.push(`https://wa.me/${phoneClean}?text=${prefill}`);
  }

  linhas.push(``);
  linhas.push(`📷 Tenho Fotos e Vídeos`);
  linhas.push(``);
  linhas.push(`🎯 Veículo Comigo`);

  if (tipo === "repasse") {
    linhas.push(``);
    linhas.push(
      `📣 Veiculo vendido na Modalidade de Repasse nas Condições e Estado de Conservação em que se encontra.`,
    );
    linhas.push(``);
    linhas.push(`🚨 Lembrando que, Veículo de Repasse não tem Garantia !`);
  }

  if (vitrineUrl) {
    linhas.push(``);
    linhas.push(`🚗 Veja nosso estoque completo:`);
    linhas.push(vitrineUrl);
  }

  return linhas.join("\n");
}

/**
 * Gera texto + capaUrl de repasse para um veículo.
 * Retorna null se o veículo não existir.
 * Se buscarMediaWeb falhar (cota Gemini, timeout), gera o texto sem mediaWeb — nunca aborta.
 */
export async function gerarRepasseCompleto(
  veiculoId: string,
  tipo: "repasse" | "promocao" = "repasse",
): Promise<{ texto: string; capaUrl: string | null } | null> {
  const { data: carro } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", veiculoId)
    .single();

  if (!carro) return null;

  // config_garage pode ter múltiplas linhas por user_id — nunca usar .single()/.maybeSingle()
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("whatsapp_agente, whatsapp, vitrine_slug, cidade, estado")
    .eq("user_id", carro.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = cfgRows?.[0] ?? null;
  const botPhone = cfg?.whatsapp_agente || cfg?.whatsapp || null;
  const vitrineUrl = cfg?.vitrine_slug
    ? `${process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital"}/vitrine/${cfg.vitrine_slug}`
    : null;

  // Versão rica: versao do banco, ou combinação de motor + combustivel + cambio
  const versaoRica = [carro.versao, carro.motor, carro.combustivel, carro.cambio]
    .filter(Boolean)
    .join(" ")
    .trim();

  // FIPE (valor_fipe do cadastro > parallelum) e média web em paralelo;
  // se mediaWeb falhar, texto é gerado sem ela
  const [fipe, mediaWeb] = await Promise.all([
    resolverFipe(carro, versaoRica),
    buscarMediaWeb(carro.marca, carro.modelo, versaoRica, carro.ano_modelo).catch((e) => {
      console.warn("⚠️ gerarRepasseCompleto: buscarMediaWeb falhou, continuando sem mediaWeb:", e);
      return null;
    }),
  ]);

  // Cidade com UF ("São José do Rio Preto-SP") — o 📍 do anúncio sai completo
  const cidadeUf = cfg?.cidade
    ? [String(cfg.cidade).trim(), String(cfg.estado ?? "").trim()].filter(Boolean).join("-")
    : null;
  const texto = gerarTextoRepasse(carro, fipe, mediaWeb, botPhone, tipo, vitrineUrl, cidadeUf);

  // Foto na proporção ORIGINAL (sem normalizar pra quadrado/4:5). O cron envia a
  // foto como imagem SEPARADA, antes do texto — o WhatsApp mostra a foto inteira e
  // o anúncio fica com cara de foto real, não de capa montada com barras.
  const capaUrl: string | null = carro.capa_marketing_url || carro.fotos?.[0] || null;

  return { texto, capaUrl };
}
