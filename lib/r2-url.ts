// Reescreve URLs de R2 para passar pelo proxy /api/r2/<key>
// Isso evita o rate-limit do pub-xxx.r2.dev no browser.
const R2_DOMAINS = [
  "pub-2bb6444be4534fb686a17d19cf31e8b1.r2.dev",
];

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
