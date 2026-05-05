import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { rateLimit } from "@/lib/redis";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    // Lê dentro da função para garantir que pega o valor atual do env var
    const DEMO_TENANT_ID = process.env.DEMO_TENANT_USER_ID;
    console.log("🔍 demo-chat | DEMO_TENANT_ID:", DEMO_TENANT_ID ?? "NÃO CONFIGURADO");

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const rl = await rateLimit(`demo-chat:${ip}`, 20, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Muitas mensagens. Aguarde um momento." }, { status: 429 });
    }

    if (!DEMO_TENANT_ID) {
      return NextResponse.json({ error: "Demo não configurado" }, { status: 503 });
    }

    const { message, history = [] } = await req.json();
    if (!message?.trim()) return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });

    // Carrega config e veículos do tenant demo em paralelo
    const [configRes, veiculosRes] = await Promise.all([
      supabaseAdmin
        .from("config_garage")
        .select("nome_empresa, nome_agente, whatsapp, tom")
        .eq("user_id", DEMO_TENANT_ID)
        .single(),
      supabaseAdmin
        .from("veiculos")
        .select("marca, modelo, ano, ano_modelo, preco_sugerido, km, cor, descricao, opcionais")
        .eq("user_id", DEMO_TENANT_ID)
        .eq("status_venda", "DISPONIVEL")
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    const config = configRes.data;
    const veiculos = veiculosRes.data ?? [];
    console.log("🚗 demo-chat | veículos encontrados:", veiculos.length, veiculos.map(v => v.modelo));
    if (veiculosRes.error) console.error("❌ demo-chat | erro veiculos:", veiculosRes.error);

    const nomeEmpresa = config?.nome_empresa ?? "Revenda Demo";
    const nomeAgente  = "Zap";
    const whatsapp    = config?.whatsapp     ?? "";

    const estoqueTexto = veiculos.length === 0
      ? "Nenhum veículo disponível no momento."
      : veiculos.map(v => {
          const ano = v.ano_modelo && v.ano_modelo !== v.ano ? `${v.ano}/${v.ano_modelo}` : v.ano;
          const preco = v.preco_sugerido ? `R$ ${Number(v.preco_sugerido).toLocaleString("pt-BR")}` : "Consulte";
          const km    = v.km    ? `${Number(v.km).toLocaleString("pt-BR")} km` : "0 km";
          const linha = [`${v.marca} ${v.modelo} ${ano}`, preco, km, v.cor].filter(Boolean).join(" · ");
          return `- ${linha}${v.descricao ? `\n  ${v.descricao.slice(0, 120)}` : ""}`;
        }).join("\n");

    const systemInstruction = `Você é ${nomeAgente}, assistente virtual de vendas da ${nomeEmpresa}.
Você está atendendo clientes pelo chat do site da revenda.
Seja natural, amigável e direto — como um bom vendedor presencial faria.

ESTOQUE DISPONÍVEL:
${estoqueTexto}

REGRAS IMPORTANTES:
- Responda sempre em português brasileiro
- Nunca invente veículos fora do estoque acima
- Se o cliente perguntar por um modelo que não está no estoque, diga que não temos no momento e ofereça as opções mais próximas
- Para agendar uma visita, use o WhatsApp: ${whatsapp || "disponível no site"}
- Ao final do atendimento, se o cliente estiver interessado, sugira agendar uma visita presencial
- Esta é uma demonstração real do sistema AutoZap — se o cliente perguntar sobre a tecnologia, diga que é o AutoZap (autozap.digital)
- Mantenha respostas curtas e objetivas (máx 3 parágrafos)`;

    const model = genAI.getGenerativeModel(
      { model: "gemini-2.5-flash", systemInstruction },
      { apiVersion: "v1beta" }
    );

    const firstUserIdx = history.findIndex((m: { role: string }) => m.role === "user");
    const validHistory = firstUserIdx === -1 ? [] : history.slice(firstUserIdx);

    const chat = model.startChat({
      history: validHistory.map((m: { role: string; text: string }) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.text }],
      })),
    });

    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("❌ Demo chat error:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
