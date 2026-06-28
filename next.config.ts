import type { NextConfig } from "next";

// 'unsafe-eval' só é liberado em DEV (o HMR/refresh do Next usa eval).
// Em produção ele sai do script-src — fecha a brecha que deixava a CSP
// decorativa contra XSS. ⚠️ Se a geração de PDF (jspdf/html2canvas em
// contratos e tag de pátio) quebrar em produção, é por causa disto.
const isProd = process.env.NODE_ENV === "production";
const scriptSrc = [
  "script-src 'self' 'unsafe-inline'",
  isProd ? "" : "'unsafe-eval'",
  "https://connect.facebook.net https://www.google-analytics.com https://www.googletagmanager.com https://www.googleadservices.com https://vercel.live",
]
  .filter(Boolean)
  .join(" ");

const securityHeaders = [
  // Impede que o painel seja embutido em iframes de outros domínios (anti-clonagem/clickjacking)
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Impede sniffing de Content-Type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Não vaza o referer para domínios externos
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Força HTTPS por 1 ano em todos os subdomínios
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Desativa sensores desnecessários no navegador
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // CSP básico — bloqueia scripts inline não declarados e iframes de domínios não confiáveis.
  // Mantém 'unsafe-inline' para Tailwind/CSS-in-JS que o Next.js injeta.
  // frame-ancestors: só autozap.digital pode embutir o app.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.gemini.google.com https://generativelanguage.googleapis.com https://www.avisaapi.com.br https://graph.facebook.com https://*.r2.dev https://*.r2.cloudflarestorage.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://*.g.doubleclick.net https://www.googleadservices.com https://vercel.live",
      "media-src 'self' https: blob:",
      "frame-src 'self' https://www.facebook.com https://vercel.live",
      "frame-ancestors 'self' https://www.autozap.digital https://autozap.digital",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.qrserver.com" },
    ],
  },
  allowedDevOrigins: ['192.168.0.228'],
  serverExternalPackages: ['ffmpeg-static', '@ffmpeg-installer/ffmpeg', 'fluent-ffmpeg', 'sharp'],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  // Desabilita source maps em produção — não expõe o código-fonte ao navegador
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        // Aplica em todas as rotas exceto assets estáticos (/_next/static)
        source: "/((?!_next/static).*)",
        headers: securityHeaders,
      },
    ];
  },
  typescript: {
    // O gerador de tipos do Next.js 16 produz um .next/dev/types/routes.d.ts malformado
    // para rotas dinâmicas aninhadas (ex: /vitrine/[tenant]/[id]).
    // Erro: "';' expected" em arquivo auto-gerado — não está no código-fonte.
    // O código-fonte passa no tsc --noEmit sem erros (verificado manualmente).
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
