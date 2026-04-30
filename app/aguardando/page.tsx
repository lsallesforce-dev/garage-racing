"use client";

import { supabase } from "@/lib/supabase";

export default function AguardandoPage() {
  return (
    <div className="min-h-screen bg-[#efefed] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center mb-8">
          <h1 className="text-4xl font-black tracking-tighter italic">
            <span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span>
          </h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mx-auto mb-5">
            <span className="text-2xl">⏳</span>
          </div>

          <h2 className="text-[13px] font-black uppercase tracking-[0.2em] text-gray-900 mb-2">
            Cadastro em Análise
          </h2>
          <p className="text-sm text-gray-500 leading-relaxed mb-6">
            Seu cadastro foi recebido e está sendo analisado pela nossa equipe.
            Entraremos em contato em breve para liberar o seu acesso.
          </p>

          <div className="bg-gray-50 rounded-xl px-4 py-3 mb-6">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              Dúvidas? Fale conosco
            </p>
            <a href="https://wa.me/5517991141010"
              className="text-sm font-black text-green-600 hover:text-green-700 transition-colors">
              WhatsApp →
            </a>
          </div>

          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.href = "/login"; }}
            className="text-[10px] text-gray-400 hover:text-gray-600 font-bold uppercase tracking-widest transition-colors">
            Sair da conta
          </button>
        </div>

        <p className="text-center text-[10px] text-gray-400 mt-6 uppercase tracking-widest">
          AutoZap © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
