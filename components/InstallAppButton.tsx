"use client";

/**
 * "Instalar o app" no menu lateral do painel. A regra de decisão mora em
 * `lib/install-client.ts`; aqui é só a tela. Já instalado (abrindo como app)
 * → some. Sem instalação nativa disponível → abre o passo a passo certo pra
 * plataforma (instrução errada é pior que nenhuma).
 */

import { useCallback, useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";
import {
  hasInstallPrompt,
  isIosSafari,
  isStandalone,
  onInstallPromptChange,
  promptInstall,
  registrarServiceWorker,
  resolveInstallVariant,
  type InstallVariant,
} from "@/lib/install-client";

function PassoAPasso({ modo }: { modo: InstallVariant }) {
  if (modo === "ios") {
    const safari = isIosSafari(navigator.userAgent, navigator.maxTouchPoints);
    return (
      <div className="space-y-2 text-sm text-gray-600">
        {!safari && (
          <p>
            No iPhone, só o <strong className="text-gray-900">Safari</strong> instala. Abra o painel nele e siga os passos.
          </p>
        )}
        <ol className="list-decimal space-y-1 pl-5">
          <li>Toque em <strong className="text-gray-900">Compartilhar</strong> — o quadrado com a seta pra cima.</li>
          <li>Role e toque em <strong className="text-gray-900">Adicionar à Tela de Início</strong>.</li>
          <li>Confirme em Adicionar. O AutoZap aparece junto com seus outros apps.</li>
        </ol>
      </div>
    );
  }
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-600">
      <li>Abra o menu do navegador — os <strong className="text-gray-900">três pontinhos</strong> no canto superior.</li>
      <li>Toque em <strong className="text-gray-900">Instalar app</strong> (em alguns aparelhos: &ldquo;Adicionar à tela inicial&rdquo;).</li>
      <li>Confirme. O AutoZap aparece junto com seus outros apps.</li>
    </ol>
  );
}

export function InstallAppButton({ onDone }: { onDone?: () => void }) {
  // `null` até hidratar: decidir no servidor daria o botão errado no iPhone.
  const [modo, setModo] = useState<InstallVariant | null>(null);
  const [passos, setPassos] = useState(false);

  useEffect(() => {
    registrarServiceWorker();
    const reavaliar = () =>
      setModo(
        resolveInstallVariant({
          userAgent: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints,
          standalone: isStandalone(),
          hasPrompt: hasInstallPrompt(),
        }),
      );
    reavaliar();
    return onInstallPromptChange(reavaliar);
  }, []);

  const instalar = useCallback(async () => {
    if (modo === "native") {
      const resposta = await promptInstall();
      // Aceitou ou recusou: nada a mostrar — recusa não é erro, o botão fica.
      if (resposta !== null) {
        onDone?.();
        return;
      }
      // Evento sumiu no caminho (é de uso único): cai no passo a passo.
    }
    setPassos(true);
  }, [modo, onDone]);

  if (modo === null || modo === "hidden") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void instalar()}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all w-full text-left text-red-600 hover:bg-white/50 mb-2"
      >
        <Smartphone size={16} />
        <span className="font-bold text-[11px] uppercase tracking-wider">
          {modo === "native" ? "Instalar o app" : "Instalar no celular"}
        </span>
      </button>

      {passos && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
          onClick={() => setPassos(false)}
        >
          <div
            role="dialog"
            aria-labelledby="instalar-titulo"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 id="instalar-titulo" className="text-base font-black text-gray-900">
                Instalar o AutoZap no celular
              </h2>
              <button onClick={() => setPassos(false)} className="text-gray-400 hover:text-gray-700" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
            <PassoAPasso modo={modo} />
            <button
              type="button"
              onClick={() => setPassos(false)}
              className="mt-4 w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
}
