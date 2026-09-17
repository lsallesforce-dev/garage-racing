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
export type FormatoPost = "feed" | "story";

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
      throw new Error(`O Instagram não conseguiu processar a imagem: ${r.status ?? r.status_code}`);
    }
    await new Promise((s) => setTimeout(s, espera));
    espera = Math.min(espera * 1.5, 3000);
  }
  throw new Error("O Instagram demorou demais para processar as imagens. Tente de novo em um minuto.");
}

/**
 * Tira do ar um post publicado (Facebook ou Instagram).
 *
 * Usado quando o carro é VENDIDO: o anúncio pago já era pausado
 * (lib/meta-campanhas.ts), mas o post orgânico continuava no feed atraindo
 * mensagem sobre carro que não existe mais.
 *
 * ⚠️ Facebook funciona com o que a gente já tem (`pages_manage_posts`).
 * O Instagram exige a permissão **`instagram_manage_contents`**, que o app
 * ainda NÃO tem (hoje só `instagram_basic` + `instagram_content_publish`) —
 * precisa de App Review. Até lá a chamada falha e o post do IG tem que sair na
 * mão; por isso o permalink fica guardado em `veiculos.marketing_posts`.
 */
export async function apagarPost(postId: string, pageToken: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${postId}?access_token=${encodeURIComponent(pageToken)}`, {
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
  legenda: string;
  formato: FormatoPost;
}): Promise<{ mediaId: string; permalink: string }> {
  const imagens = p.imagens.filter(Boolean).slice(0, 10);
  if (!imagens.length) throw new Error("Nenhuma imagem para publicar.");

  if (p.formato === "story") {
    const c = await post(`${p.igUserId}/media`, p.pageToken, {
      image_url: imagens[0],
      media_type: "STORIES",
    });
    await esperarContainer(c.id, p.pageToken);
    const r = await post(`${p.igUserId}/media_publish`, p.pageToken, { creation_id: c.id });
    return { mediaId: r.id, permalink: await linkDaMidia(r.id, p.pageToken) };
  }

  if (imagens.length === 1) {
    const c = await post(`${p.igUserId}/media`, p.pageToken, {
      image_url: imagens[0],
      caption: p.legenda,
    });
    await esperarContainer(c.id, p.pageToken);
    const r = await post(`${p.igUserId}/media_publish`, p.pageToken, { creation_id: c.id });
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
  const r = await post(`${p.igUserId}/media_publish`, p.pageToken, { creation_id: pai.id });
  return { mediaId: r.id, permalink: await linkDaMidia(r.id, p.pageToken) };
}
