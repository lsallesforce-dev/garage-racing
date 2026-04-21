// Reescreve URLs de R2 para passar pelo proxy /api/r2/<key>
// Isso evita o rate-limit do pub-xxx.r2.dev no browser e em chamadas externas (Meta API).
const R2_DOMAINS = [
  "pub-2bb6444be4534fb686a17d19cf31e8b1.r2.dev",
];

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://autozap.digital";

// Para uso no browser (path relativo)
export function toVideoUrl(url: string | null | undefined): string {
  if (!url) return "";
  for (const domain of R2_DOMAINS) {
    if (url.includes(domain)) {
      const key = url.split(`${domain}/`)[1];
      return `/api/r2/${key}`;
    }
  }
  return url;
}

// Para uso em APIs externas (Meta) — usa proxy para evitar rate-limit do R2.
// APP_URL deve ser o domínio canônico (sem redirect).
const CANONICAL_URL = process.env.CANONICAL_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital";

export function toVideoUrlAbsolute(url: string | null | undefined): string {
  if (!url) return "";
  for (const domain of R2_DOMAINS) {
    if (url.includes(domain)) {
      const key = url.split(`${domain}/`)[1];
      return `${CANONICAL_URL}/api/r2/${key}`;
    }
  }
  return url;
}
