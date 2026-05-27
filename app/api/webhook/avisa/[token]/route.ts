// app/api/webhook/avisa/[token]/route.ts
//
// Rota dinâmica que extrai o webhook_token do PATH (em vez de query param).
// O painel do AutoZap exibe a URL nesse formato:
//   https://www.autozap.digital/api/webhook/avisa/{webhook_token}
//
// Mas a Avisa API por padrão envia POST nesse mesmo path. Antes, só existia a
// rota estática (/api/webhook/avisa) que lia o token via ?token= — qualquer
// chamada em /api/webhook/avisa/{token} resultava em 404.
//
// Esta rota injeta o token no req.url como query param e delega pra rota
// estática original, mantendo TODA a lógica de processamento em um único lugar.

import { NextRequest } from "next/server";
import { POST as POST_handler } from "../route";

export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Cria uma cópia da request com o token no query string + repassa pra
  // rota original. Mais limpo do que duplicar toda a lógica de parsing.
  const url = new URL(req.url);
  url.pathname = "/api/webhook/avisa";
  if (token) url.searchParams.set("token", token);

  const forwarded = new NextRequest(url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    // @ts-expect-error — duplex é necessário pra body em stream
    duplex: "half",
  });

  return POST_handler(forwarded);
}
