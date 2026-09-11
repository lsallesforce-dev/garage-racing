"use client";

// Pixel da Meta na vitrine pública do tenant.
//
// Por que existe: o anúncio de catálogo (Automotive Inventory Ads) manda a
// pessoa pro SITE, não pro WhatsApp. Sem pixel a Meta não enxerga nada depois
// do clique — não sabe quem olhou qual carro, não persegue quem visitou e
// sumiu, e só consegue otimizar por clique. Os anúncios de UM carro nunca
// precisaram disso porque medem a conversa dentro do próprio WhatsApp.
//
// `content_ids` usa o `veiculos.id`, o MESMO valor que vai no `vehicle_id` do
// feed (app/vitrine/[tenant]/feed.csv). É esse casamento que liga "fulano viu
// o carro X no site" ao item X do catálogo — se os dois divergirem, o
// retargeting simplesmente não acha o produto e a campanha vira prospecção.
//
// A CSP já libera connect.facebook.net (script-src) e *.facebook.com
// (connect-src), então não precisou mexer em next.config.ts.

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

let rotaJaContada: string | null = null;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Id do carro do card em volta do botão, pelo link /vitrine/{slug}/{id} do próprio card. */
function idDoCarroEmVolta(el: Element | null | undefined): string | null {
  const card = el?.closest("article");
  const link = card?.querySelector<HTMLAnchorElement>('a[href*="/vitrine/"]');
  return link?.getAttribute("href")?.match(UUID_RE)?.[0] ?? null;
}

export type PixelViewContent = {
  /** veiculos.id — tem que ser igual ao vehicle_id do feed. */
  id: string;
  nome: string;
  valor?: number | null;
};

export default function MetaPixel({
  pixelId,
  viewContent,
}: {
  pixelId?: string | null;
  viewContent?: PixelViewContent | null;
}) {
  const pathname = usePathname();

  // O código base já dispara um PageView no load, então o efeito abaixo cobre
  // só as navegações seguintes do App Router.
  //
  // A marca é de MÓDULO, não um useRef: cada página da vitrine renderiza o seu
  // próprio <MetaPixel>, então o componente REMONTA a cada navegação e um ref
  // voltaria a "primeira rota" toda vez — engolindo o PageView de todas as
  // páginas seguintes (medido em produção: navegar da lista pro carro saía só
  // com ViewContent). Uma variável de módulo sobrevive à remontagem.
  useEffect(() => {
    if (rotaJaContada === null) {
      rotaJaContada = pathname; // esta é a que o código base já contou
      return;
    }
    if (rotaJaContada === pathname) return;
    rotaJaContada = pathname;
    window.fbq?.("track", "PageView");
  }, [pathname]);

  useEffect(() => {
    if (!viewContent) return;
    window.fbq?.("track", "ViewContent", {
      content_type: "vehicle",
      content_ids: [viewContent.id],
      content_name: viewContent.nome,
      ...(viewContent.valor ? { value: viewContent.valor, currency: "BRL" } : {}),
    });
  }, [viewContent?.id]);

  // Lead no clique de QUALQUER botão de WhatsApp da vitrine — card da lista,
  // página do carro, modal de financiamento e o botão flutuante. Um listener
  // no documento em vez de um onClick espalhado por cinco componentes: os
  // links todos saem do mesmo whatsappLink(), e um onClick esquecido num
  // deles vira buraco silencioso na medição.
  //
  // + AddToCart COM o id do carro, quando dá pra saber qual carro é. Motivo:
  // a campanha de catálogo roda no objetivo Vendas, e Vendas NÃO aceita Lead
  // como evento de otimização (Meta #2446814, visto em 11/09). O teste de 20
  // dias otimizou "Ver conteúdo" e trouxe 673 visitas a R$ 0,10 e nenhuma
  // conversa — gente que abre a página, não gente que chama. AddToCart é
  // evento de funil de compra, então Vendas aceita, e passa a significar aqui
  // "abriu o carro E clicou pra conversar". O content_ids precisa ser o
  // veiculos.id (= vehicle_id do feed) pra Meta casar o clique com o item.
  //
  // Qual carro: primeiro o card em volta do botão (<article> com o link
  // /vitrine/{slug}/{id} — vale nos dois layouts, na lista e no "Mais carros"
  // da página do carro); senão o carro da própria página. Botão genérico da
  // lista (cabeçalho, flutuante) não tem carro: vai só o Lead, porque
  // AddToCart sem produto não serve pro catálogo e só suja o sinal.
  useEffect(() => {
    if (!pixelId) return;
    function aoClicar(e: MouseEvent) {
      const alvo = (e.target as HTMLElement | null)?.closest?.("a");
      const href = alvo?.getAttribute("href") ?? "";
      if (!/(^https?:\/\/)?(api\.whatsapp\.com|wa\.me)\//i.test(href)) return;
      window.fbq?.("track", "Lead", { content_type: "vehicle" });

      const idDoCard = idDoCarroEmVolta(alvo);
      const id = idDoCard ?? viewContent?.id ?? null;
      if (!id) return;
      // Valor só quando o clique é no carro da página — card de outro carro
      // (o "Mais carros") não traz preço aqui.
      const valor = !idDoCard || idDoCard === viewContent?.id ? viewContent?.valor : null;
      window.fbq?.("track", "AddToCart", {
        content_type: "vehicle",
        content_ids: [id],
        ...(valor ? { value: valor, currency: "BRL" } : {}),
      });
    }
    document.addEventListener("click", aoClicar, true);
    return () => document.removeEventListener("click", aoClicar, true);
  }, [pixelId, viewContent?.id, viewContent?.valor]);

  if (!pixelId) return null;

  return (
    <Script
      id="meta-pixel"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', ${JSON.stringify(String(pixelId))});
fbq('track', 'PageView');`,
      }}
    />
  );
}
