"use client";

import { useState, useRef, useEffect } from "react";
import { X, Send, Loader2, ChevronDown, Trash2, Headphones } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";

const SUPPORT_WHATSAPP = "5517991141010";

interface Message {
  role: "user" | "assistant";
  text: string;
}

const WELCOME: Message = { role: "assistant", text: "Oi! Eu sou o **Zap**, assistente do AutoZap. Como posso te ajudar hoje?" };

export function ZapWidget({ userId }: { userId?: string }) {
  const pathname = usePathname();
  const storageKey = userId ? `zap_chat_history_${userId}` : null;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Carrega histórico salvo ao montar (ou quando o userId resolver)
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Message[];
        if (parsed.length > 0) setMessages(parsed);
      } else {
        setMessages([WELCOME]);
      }
    } catch {}
  }, [storageKey]);

  // Salva histórico sempre que muda
  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {}
  }, [messages, storageKey]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, messages]);

  if (pathname === "/chat") return null;

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, text: m.text }));
      const res = await fetch("/api/zap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.reply ?? "Não consegui processar sua pergunta. Tente novamente." },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Erro de conexão. Verifique sua internet e tente novamente." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function getSupportLink() {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const text = lastUserMsg
      ? `Olá! Preciso de ajuda com o AutoZap. Minha dúvida: ${lastUserMsg.text}`
      : "Olá! Preciso de ajuda com o AutoZap.";
    return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`;
  }

  function renderText(text: string) {
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    return escaped
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br />")
      .replace(
        /(\+?55[\s\-]?\d{2}[\s\-]?\d{4,5}[\s\-]?\d{4})/g,
        (match) => {
          const digits = match.replace(/\D/g, "");
          const num = digits.startsWith("55") ? digits : `55${digits}`;
          return `<a href="https://wa.me/${num}" target="_blank" rel="noopener noreferrer" style="color:#16a34a;font-weight:600;text-decoration:underline;">${match}</a>`;
        }
      );
  }

  return (
    <>
      {/* Botão flutuante */}
      <div className="fixed bottom-6 right-6 z-50 group">
        {/* Balão "Posso te ajudar?" — aparece no hover quando fechado */}
        {!open && (
          <div className="absolute bottom-full right-1 mb-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            <div className="bg-white text-gray-800 text-[11px] font-bold px-3 py-1.5 rounded-2xl shadow-lg border border-gray-100 whitespace-nowrap">
              Posso te ajudar?
            </div>
            {/* Ponteiro do balão */}
            <div className="absolute bottom-[-5px] right-5 w-3 h-3 bg-white border-b border-r border-gray-100 rotate-45" />
          </div>
        )}

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Fechar Zap" : "Abrir Zap"}
          className={`w-16 h-16 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 overflow-hidden ${
            open
              ? "bg-gray-800 scale-95"
              : "bg-white hover:scale-110 ring-2 ring-red-600"
          }`}
        >
          {open ? (
            <ChevronDown size={22} className="text-white" />
          ) : (
            <Image
              src="/zap-mascot.png"
              alt="Zap"
              width={64}
              height={64}
              className="object-cover scale-110"
            />
          )}
        </button>
      </div>

      {/* Painel de chat */}
      <div
        className={`fixed bottom-28 right-6 z-50 w-80 sm:w-96 flex flex-col rounded-2xl shadow-2xl overflow-hidden border border-gray-200 bg-white transition-all duration-300 origin-bottom-right ${
          open ? "scale-100 opacity-100 pointer-events-auto" : "scale-90 opacity-0 pointer-events-none"
        }`}
        style={{ maxHeight: "520px" }}
      >
        {/* Header */}
        <div className="bg-gray-900 px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 ring-2 ring-red-600 bg-white">
            <Image
              src="/zap-mascot.png"
              alt="Zap"
              width={40}
              height={40}
              className="object-cover scale-110"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-sm uppercase tracking-wider leading-none">ZAP AI</p>
            <p className="text-green-400 text-[9px] font-bold uppercase tracking-widest mt-0.5">● Online</p>
          </div>
          <button
            onClick={() => { setMessages([WELCOME]); if (storageKey) localStorage.removeItem(storageKey); }}
            title="Limpar conversa"
            className="text-gray-500 hover:text-red-400 transition-colors p-1"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-white transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#f4f4f2]" style={{ minHeight: 0 }}>
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 mr-2 mt-0.5 bg-white ring-1 ring-red-300">
                  <Image
                    src="/zap-mascot.png"
                    alt="Zap"
                    width={28}
                    height={28}
                    className="object-cover scale-110"
                  />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-red-600 text-white rounded-tr-sm"
                    : "bg-white text-gray-800 shadow-sm rounded-tl-sm border border-gray-100"
                }`}
                dangerouslySetInnerHTML={{ __html: renderText(msg.text) }}
              />
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 mr-2 mt-0.5 bg-white ring-1 ring-red-300">
                <Image src="/zap-mascot.png" alt="Zap" width={28} height={28} className="object-cover scale-110" />
              </div>
              <div className="bg-white rounded-2xl rounded-tl-sm px-3 py-2 shadow-sm border border-gray-100 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin text-gray-400" />
                <span className="text-[11px] text-gray-400 italic">Pensando...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suporte humano */}
        <div className="px-3 pt-1.5 pb-0 bg-white flex justify-center">
          <a
            href={getSupportLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-red-600 transition-colors group"
          >
            <Headphones size={11} className="group-hover:text-red-600" />
            Falar com suporte humano
          </a>
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 bg-white px-3 py-2.5 flex items-center gap-2 mt-1.5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Pergunte ao Zap..."
            disabled={loading}
            className="flex-1 text-[12px] bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200 disabled:opacity-50 placeholder:text-gray-400"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-200 flex items-center justify-center transition-colors shrink-0"
          >
            <Send size={13} className="text-white" />
          </button>
        </div>
      </div>
    </>
  );
}
