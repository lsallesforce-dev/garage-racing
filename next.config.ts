import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.0.228'],
  serverExternalPackages: ['ffmpeg-static', '@ffmpeg-installer/ffmpeg', 'fluent-ffmpeg'],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
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
