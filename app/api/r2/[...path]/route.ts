// Proxy para arquivos do R2 — evita rate-limit do pub-xxx.r2.dev no browser.
// Serve via autozap.digital/api/r2/<key> com suporte a Range requests (seek de vídeo).

export const maxDuration = 60;

const R2_ORIGIN = process.env.R2_PUBLIC_URL!; // https://pub-xxx.r2.dev

// Formato aceito de chave. O bucket tem objetos na raiz (upload/ig-download) e em
// prefixos (marketing/, takes/, fonte/, reels/, musicas/), então não dá pra usar
// allowlist de prefixo — o que se valida é o FORMATO: sem "..", sem "//", sem ":"
// (evita `https:` virar origem nova) e só o charset que os nossos uploads geram.
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,250}$/;

function keyOk(key: string): boolean {
  if (!KEY_RE.test(key)) return false;
  if (key.includes("..") || key.includes("//")) return false;
  return true;
}

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const key = (await params).path.join("/");

  // Chave fora do formato nunca existiu no bucket — 404 direto, sem tocar no R2.
  // Fecha manipulação de path contra a origem e sondagem de enumeração.
  if (!keyOk(key)) return new Response("Not found", { status: 404 });

  const upstream = await fetch(`${R2_ORIGIN}/${encodeURI(key)}`, {
    headers: {
      ...(req.headers.get("range") ? { range: req.headers.get("range")! } : {}),
    },
  });

  if (!upstream.ok && upstream.status !== 206) {
    console.error(`R2 proxy error: ${upstream.status} for key=${key}`);
    return new Response("Not found", { status: upstream.status });
  }

  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(upstream.body, { status: upstream.status, headers });
}
