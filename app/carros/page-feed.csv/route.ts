// Page feed pro Google Ads (Dynamic Search Ads / Performance Max URL expansion).
// CSV "Page URL,Custom label" com as landing pages do portal — o Google cria os
// anúncios sozinho e mira só essas URLs. Sem VIN, sem store_code, sem GBP.
// URL: https://www.autozap.digital/carros/page-feed.csv
import { getPortalLandingPaths } from "@/lib/portal/query";

export const revalidate = 600; // 10 min

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");

const titleCaseSlug = (s: string) =>
  s.split("-").map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");

const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function GET() {
  const paths = await getPortalLandingPaths();

  const linhas: string[] = ["Page URL,Custom label"];
  linhas.push(`${cell(`${SITE}/carros`)},${cell("Todos os carros")}`);

  for (const p of paths) {
    // labels = segmentos do slug (marca; modelo; cidade) pra agrupar no Ads
    const labels = p.split("/").map(titleCaseSlug).join(";");
    linhas.push(`${cell(`${SITE}/carros/${p}`)},${cell(labels)}`);
  }

  return new Response(linhas.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
      "Content-Disposition": "inline; filename=autozap-page-feed.csv",
    },
  });
}
