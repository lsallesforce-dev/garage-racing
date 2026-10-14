/**
 * Instalar o painel AutoZap no celular (PWA) — a parte que roda no navegador.
 * Portado do Tem Prêmio (`loterias/src/lib/install-client.ts`).
 *
 * Três realidades que o botão cobre:
 * 1. Chrome/Edge (Android e desktop) disparam `beforeinstallprompt` — guarda o
 *    evento e um clique abre a instalação de verdade.
 * 2. iPhone/iPad não têm esse evento: instalar é manual, pelo Compartilhar do
 *    Safari (e SÓ pelo Safari). O botão ensina.
 * 3. O resto (Firefox, ou Chrome que ainda não disparou o evento) também
 *    ensina, pelo menu do navegador.
 *
 * O botão NÃO depende do evento pra aparecer: o Chrome manda quando quer, às
 * vezes bem depois da hidratação, e o botão sumiria justo na primeira visita.
 */

/** O evento do Chrome. Não está na `lib.dom`, então o contrato vai explícito. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallVariant = "hidden" | "native" | "ios" | "manual";

export function resolveInstallVariant(ctx: {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  hasPrompt: boolean;
}): InstallVariant {
  if (ctx.standalone) return "hidden";
  if (ctx.hasPrompt) return "native";
  return isIosLike(ctx.userAgent, ctx.maxTouchPoints) ? "ios" : "manual";
}

/** iPad moderno se anuncia como "Macintosh" e só se distingue pelo toque. */
export function isIosLike(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return userAgent.includes("Macintosh") && maxTouchPoints > 1;
}

/** Safari é o ÚNICO navegador que instala no iOS — Chrome e Firefox lá não. */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  if (!isIosLike(userAgent, maxTouchPoints)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}

let guardado: BeforeInstallPromptEvent | null = null;
const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

// Efeito de import, não useEffect, de propósito: o Chrome dispara
// `beforeinstallprompt` UMA vez por carregamento e não repete pra quem
// registrar depois.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (evento) => {
    // Sem o preventDefault o Chrome mostra a barra dele por cima da nossa.
    evento.preventDefault();
    guardado = evento as BeforeInstallPromptEvent;
    avisar();
  });

  window.addEventListener("appinstalled", () => {
    guardado = null;
    avisar();
  });
}

export function hasInstallPrompt(): boolean {
  return guardado !== null;
}

export function onInstallPromptChange(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Já está rodando como app instalado? */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Abre a instalação nativa. `null` = não havia evento guardado (quem chama cai
 * no passo a passo). O evento é de uso único.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const evento = guardado;
  if (evento === null) return null;
  guardado = null;
  avisar();
  await evento.prompt();
  const { outcome } = await evento.userChoice;
  return outcome;
}

/** Registra o service worker — sem ele o Chrome não oferece "Instalar app". */
export function registrarServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Sem SW o painel funciona igual; só não fica instalável neste navegador.
  });
}
