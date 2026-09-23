// Publicação ORGÂNICA (post normal) na Página do Facebook e no Instagram.
//
// Não confundir com lib/meta-ads.ts: lá é anúncio pago (campanha, conjunto,
// criativo, verba). Aqui é o post que sai no feed da loja de graça, o mesmo que
// o lojista faria na mão pelo celular — só que com as artes e a legenda que o
// Kit de Postagem já gerou.
//
// Permissões que isso exige (App Review, ver docs/meta-app-review-postagem.md):
//   pages_manage_posts        → postar na Página
//   instagram_basic           → achar a conta do Instagram ligada à Página
//   instagram_content_publish → postar no Instagram
//
// ⚠️ Token: a Página publica com o PAGE access token (vem de /me/accounts), não
// com o token do usuário. O do Instagram é o MESMO page token — a conta do IG
// é publicada "através" da Página a que ela está vinculada.

const GRAPH = "https://graph.facebook.com/v23.0";

export type DestinoPost = "facebook" | "instagram";
/**
 * feed         → fotos do kit no feed (Face e/ou Insta)
 * story        → arte 9:16 como story
 * reels        → o REEL (vídeo) do kit publicado como Reels do Instagram
 * story_video  → o mesmo reel publicado como story em vídeo
 */
export type FormatoPost = "feed" | "story" | "reels" | "story_video";

/** Formatos que usam o VÍDEO do kit em vez das artes. */
export function usaVideo(f: FormatoPost): boolean {
  return f === "reels" || f === "story_video";
}

async function post(path: string, token: string, body: Record<string, any>) {
  const res = await fetch(`${GRAPH}/${path}?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) {
    const e = data.error;
    console.error(`[meta-organico POST ${path}]`, JSON.stringify(e));
    const sub = e.error_subcode ? `/${e.error_subcode}` : "";
    const msg = e.error_user_msg || e.message;
    throw new Error(`Meta [${path}]: ${msg} (code ${e.code}${sub})`);
  }
  return data;
}

async function get(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) throw new Error(`Meta [${path}]: ${data.error.error_user_msg || data.error.message}`);
  return data;
}

/**
 * Espera o container do Instagram ficar pronto.
 *
 * O upload do IG é assíncrono: `/media` devolve o id na hora, mas a Meta ainda
 * está BAIXANDO a imagem da URL. Publicar antes disso falha com 9007/2207027
 * ("Media ID is not available" / "A mídia não está pronta para ser publicada").
 * Foi o que derrubou o post do Cronos na APROVE (17/09) — o Facebook saiu, o
 * Instagram não, porque o código publicava no mesmo instante em que criava.
 *
 * As artes do kit são PNG de ~1,8 MB; com 10 imagens a Meta leva alguns
 * segundos por container.
 */
async function esperarContainer(id: string, token: string, tetoMs = 25000): Promise<void> {
  const limite = Date.now() + tetoMs;
  let espera = 800;
  while (Date.now() < limite) {
    const r = await get(id, token, { fields: "status_code,status" });
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") {
      throw new Error(`O Instagram não conseguiu processar a mídia: ${r.status ?? r.status_code}`);
    }
    await new Promise((s) => setTimeout(s, espera));
    espera = Math.min(espera * 1.5, 3000);
  }
  throw new Error("O Instagram demorou demais para processar a mídia. Tente de novo em um minuto.");
}

/**
 * Publica o container do Instagram, tolerando o 9007.
 *
 * O `esperarContainer` já garante status_code=FINISHED antes daqui — e MESMO
 * ASSIM o /media_publish volta 9007 ("Media ID is not available", subcode
 * 2207027) de vez em quando. O FINISHED do carrossel chega antes de a mídia
 * estar publicável de fato; é atraso de propagação do lado da Meta, não erro
 * nosso. Caso real (APROVE 23/09): Saveiro Robust com 6 fotos — Facebook
 * publicou, Instagram não. Mesma coisa tinha acontecido com o Cronos em 17/09
 * e foi "resolvida" com a espera, que reduziu mas não eliminou.
 *
 * Então o publish insiste: 5 tentativas, ~55s no total. maxDuration da rota é
 * 300s, cabe. Qualquer erro que NÃO seja 9007 sobe na hora.
 */
async function publicarNoInstagram(
  igUserId: string,
  pageToken: string,
  creationId: string,
): Promise<any> {
  const esperas = [3000, 6000, 10000, 15000, 20000];
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await post(`${igUserId}/media_publish`, pageToken, { creation_id: creationId });
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const ehNaoPronta = msg.includes("9007") || msg.includes("2207027");
      if (!ehNaoPronta || tentativa >= esperas.length) throw e;
      console.warn(
        `⏳ [meta-organico] Instagram ainda não liberou a mídia (9007) — tentativa ${tentativa + 1}/${esperas.length}, esperando ${esperas[tentativa] / 1000}s`,
      );
      await new Promise((s) => setTimeout(s, esperas[tentativa]));
    }
  }
}

/**
 * Tira do ar um post publicado (Facebook ou Instagram).
 *
 * Usado quando o carro é VENDIDO: o anúncio pago já era pausado
 * (lib/meta-campanhas.ts), mas o post orgânico continuava no feed atraindo
 * mensagem sobre carro que não existe mais.
 *
 * ⚠️ Os dois lados usam TOKEN DIFERENTE, e isso não é detalhe:
 *   - Facebook (`pages_manage_posts`): token da PÁGINA.
 *   - Instagram (`instagram_basic` + `instagram_manage_contents`): token do
 *     USUÁRIO. A doc do IG Media Delete pede "Facebook User access token"
 *     explicitamente — com o token da Página a chamada volta erro de permissão
 *     mesmo com o escopo concedido. Era por isso que o post do IG ficava no ar.
 *
 * Limites da Meta (não são bug nosso): post que virou ANÚNCIO não pode ser
 * apagado por aqui, e carrossel só sai inteiro, pelo id do álbum.
 * O que não sair fica com o permalink em `veiculos.marketing_posts` pro
 * gerente apagar na mão.
 */
export async function apagarPost(
  postId: string,
  token: string,
  destino: DestinoPost = "facebook",
): Promise<void> {
  // O IG aceita DELETE e POST no mesmo id; a doc documenta os dois. Mantemos
  // DELETE, que é o que o Facebook também espera.
  void destino;
  const res = await fetch(`${GRAPH}/${postId}?access_token=${encodeURIComponent(token)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => ({}));
  if (data?.error) {
    const e = data.error;
    console.error(`[meta-organico DELETE ${postId}]`, JSON.stringify(e));
    throw new Error(e.error_user_msg || e.message);
  }
}

/**
 * Link do post da Página. O id vem como `{pageId}_{postId}` e é isso mesmo que
 * o facebook.com/ aceita na URL.
 */
function linkDoPost(id: string): string {
  return `https://www.facebook.com/${id}`;
}

/**
 * Link do post no Instagram. Só dá pra saber DEPOIS de publicado (a Meta monta
 * o shortcode), então é uma chamada extra — barata, e é o que permite abrir o
 * post direto da galeria e apagar na mão quando o carro vende.
 */
async function linkDaMidia(mediaId: string, token: string): Promise<string> {
  try {
    const r = await get(mediaId, token, { fields: "permalink" });
    return r.permalink ?? "";
  } catch {
    return "";
  }
}

export interface PaginaParaPostar {
  pageId: string;
  pageToken: string;
  pageNome: string;
  /** Conta do Instagram vinculada à Página — null quando a loja não tem. */
  igUserId: string | null;
}

/**
 * Descobre a Página (e o Instagram dela) que o tenant vai usar.
 * `pageIdPreferida` vem de meta_paginas — a que o lojista já escolheu pros
 * anúncios. Sem ela, cai na primeira Página da conta.
 */
export async function resolverPaginaParaPostar(
  userToken: string,
  pageIdPreferida?: string | null
): Promise<PaginaParaPostar> {
  const data = await get("me/accounts", userToken, {
    fields: "id,name,access_token,instagram_business_account",
  });
  const paginas: any[] = data.data ?? [];
  if (!paginas.length) throw new Error("Nenhuma Página do Facebook conectada nesta conta.");

  const escolhida = (pageIdPreferida && paginas.find((p) => p.id === pageIdPreferida)) || paginas[0];
  if (!escolhida.access_token) {
    throw new Error("A Meta não devolveu o token da Página — reconecte o Facebook em Configurações.");
  }
  return {
    pageId: escolhida.id,
    pageToken: escolhida.access_token,
    pageNome: escolhida.name ?? "",
    igUserId: escolhida.instagram_business_account?.id ?? null,
  };
}

/**
 * Post na Página do Facebook.
 *
 * Uma imagem → /photos direto. Várias → sobe cada uma como NÃO publicada e
 * junta os ids num post de feed (`attached_media`), que é o jeito de fazer
 * álbum/carrossel pela API: /photos com várias URLs criaria N posts soltos.
 */
export async function postarNoFacebook(p: {
  pageId: string;
  pageToken: string;
  imagens: string[];
  legenda: string;
}): Promise<{ postId: string; permalink: string }> {
  const imagens = p.imagens.filter(Boolean).slice(0, 10);
  if (!imagens.length) throw new Error("Nenhuma imagem para publicar.");

  if (imagens.length === 1) {
    const r = await post(`${p.pageId}/photos`, p.pageToken, {
      url: imagens[0],
      caption: p.legenda,
    });
    const id = r.post_id ?? r.id;
    return { postId: id, permalink: linkDoPost(id) };
  }

  const ids = await Promise.all(
    imagens.map((url) =>
      post(`${p.pageId}/photos`, p.pageToken, { url, published: false }).then((r) => r.id as string)
    )
  );
  const r = await post(`${p.pageId}/feed`, p.pageToken, {
    message: p.legenda,
    attached_media: ids.map((media_fbid) => ({ media_fbid })),
  });
  return { postId: r.id, permalink: linkDoPost(r.id) };
}

/**
 * Post no Instagram — feed (foto ou carrossel) ou story.
 *
 * Sempre em dois tempos: cria o container com a mídia e só depois publica. É
 * como a API do Instagram funciona, e é o que permite o carrossel (um container
 * por foto + um container "pai" com os filhos).
 *
 * A imagem tem que estar numa URL pública que a Meta consiga baixar — as artes
 * do kit no Storage do Supabase servem. Story aceita uma imagem só.
 */
export async function postarNoInstagram(p: {
  igUserId: string;
  pageToken: string;
  imagens: string[];
  /** Reel do kit — obrigatório quando o formato é `reels` ou `story_video`. */
  videoUrl?: string | null;
  legenda: string;
  formato: FormatoPost;
}): Promise<{ mediaId: string; permalink: string }> {
  // ── Vídeo: Reels ou Story em vídeo ──────────────────────────────────────────
  // Mesmo fluxo de dois tempos das fotos, mas a Meta BAIXA e TRANSCODIFICA o
  // vídeo — demora bem mais que imagem, daí o teto de espera maior (90s).
  if (usaVideo(p.formato)) {
    if (!p.videoUrl) throw new Error("Este carro ainda não tem reel pronto.");
    const c = await post(`${p.igUserId}/media`, p.pageToken, {
      media_type: p.formato === "reels" ? "REELS" : "STORIES",
      video_url: p.videoUrl,
      // Story não leva legenda (o Instagram ignora); Reels leva.
      ...(p.formato === "reels" ? { caption: p.legenda } : {}),
    });
    await esperarContainer(c.id, p.pageToken, 90000);
    const r = await publicarNoInstagram(p.igUserId, p.pageToken, c.id);
    return { mediaId: r.id, permalink: await linkDaMidia(r.id, p.pageToken) };
  }

  const imagens = p.imagens.filter(Boolean).slice(0, 10);
  if (!imagens.length) throw new Error("Nenhuma imagem para publicar.");

  if (p.formato === "story") {
    const c = await post(`${p.igUserId}/media`, p.pageToken, {
      image_url: imagens[0],
      media_type: "STORIES",
    });
    await esperarContainer(c.id, p.pageToken);
    const r = await publicarNoInstagram(p.igUserId, p.pageToken, c.id);
    return { mediaId: r.id, permalink: await linkDaMidia(r.id, p.pageToken) };
  }

  if (imagens.length === 1) {
    const c = await post(`${p.igUserId}/media`, p.pageToken, {
      image_url: imagens[0],
      caption: p.legenda,
    });
    await esperarContainer(c.id, p.pageToken);
    const r = await publicarNoInstagram(p.igUserId, p.pageToken, c.id);
    return { mediaId: r.id, permalink: await linkDaMidia(r.id, p.pageToken) };
  }

  const filhos = await Promise.all(
    imagens.map((image_url) =>
      post(`${p.igUserId}/media`, p.pageToken, { image_url, is_carousel_item: true }).then(
        (r) => r.id as string
      )
    )
  );
  // Os filhos precisam estar prontos ANTES do container pai — o pai só junta ids.
  await Promise.all(filhos.map((id) => esperarContainer(id, p.pageToken)));
  const pai = await post(`${p.igUserId}/media`, p.pageToken, {
    media_type: "CAROUSEL",
    children: filhos,
    caption: p.legenda,
  });
  await esperarContainer(pai.id, p.pageToken);
  const r = await publicarNoInstagram(p.igUserId, p.pageToken, pai.id);
  return { mediaId: r.id, permalink: await linkDaMidia(r.id, p.pageToken) };
}
