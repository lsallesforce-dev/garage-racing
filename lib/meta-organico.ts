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
}): Promise<{ postId: string }> {
  const imagens = p.imagens.filter(Boolean).slice(0, 10);
  if (!imagens.length) throw new Error("Nenhuma imagem para publicar.");

  if (imagens.length === 1) {
    const r = await post(`${p.pageId}/photos`, p.pageToken, {
      url: imagens[0],
      caption: p.legenda,
    });
    return { postId: r.post_id ?? r.id };
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
  return { postId: r.id };
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
}): Promise<{ mediaId: string }> {
  const imagens = p.imagens.filter(Boolean).slice(0, 10);
  if (!imagens.length) throw new Error("Nenhuma imagem para publicar.");

  if (p.formato === "story") {
    const c = await post(`${p.igUserId}/media`, p.pageToken, {
      image_url: imagens[0],
      media_type: "STORIES",
    });
    const r = await post(`${p.igUserId}/media_publish`, p.pageToken, { creation_id: c.id });
    return { mediaId: r.id };
  }

  if (imagens.length === 1) {
    const c = await post(`${p.igUserId}/media`, p.pageToken, {
      image_url: imagens[0],
      caption: p.legenda,
    });
    const r = await post(`${p.igUserId}/media_publish`, p.pageToken, { creation_id: c.id });
    return { mediaId: r.id };
  }

  const filhos = await Promise.all(
    imagens.map((image_url) =>
      post(`${p.igUserId}/media`, p.pageToken, { image_url, is_carousel_item: true }).then(
        (r) => r.id as string
      )
    )
  );
  const pai = await post(`${p.igUserId}/media`, p.pageToken, {
    media_type: "CAROUSEL",
    children: filhos,
    caption: p.legenda,
  });
  const r = await post(`${p.igUserId}/media_publish`, p.pageToken, { creation_id: pai.id });
  return { mediaId: r.id };
}
