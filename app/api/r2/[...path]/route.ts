// Proxy Edge para arquivos do R2 — evita rate-limit do pub-xxx.r2.dev no browser.
// Serve via autozap.digital/api/r2/<key> com suporte a Range requests (seek de vídeo).

export const runtime = "edge";

const R2_ORIGIN = process.env.R2_PUBLIC_URL!; // https://pub-xxx.r2.dev

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const key = (await params).path.join("/");
  const upstream = await fetch(`${R2_ORIGIN}/${key}`, {
    headers: {
      ...(req.headers.get("range") ? { range: req.headers.get("range")! } : {}),
    },
  });

  if (!upstream.ok && upstream.status !== 206) {
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
