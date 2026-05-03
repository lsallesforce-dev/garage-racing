"use client";

import { useState, useRef, useEffect } from "react";
import { X, Send, Loader2, ChevronDown } from "lucide-react";
import Image from "next/image";

interface Message {
  role: "user" | "assistant";
  text: string;
}

export function ZapWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Oi! Eu sou o **Zap**, assistente do AutoZap. Como posso te ajudar hoje?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, messages]);

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

  function renderText(text: string) {
    return text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br />");
  }

  return (
    <>
      {/* Botão flutuante */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Fechar Zap" : "Abrir Zap"}
        className={`fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 overflow-hidden ${
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

        {/* Input */}
        <div className="border-t border-gray-200 bg-white px-3 py-2.5 flex items-center gap-2">
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
