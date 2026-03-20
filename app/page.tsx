import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/10 rounded-full blur-[120px] animate-pulse delay-700"></div>
      </div>

      <h1 className="text-6xl md:text-8xl font-black tracking-tighter mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500">
        GARAGE<br />RACING
      </h1>
      
      <p className="text-xl md:text-2xl text-slate-400 max-w-2xl mb-12 font-light leading-relaxed">
        A próxima geração de inteligência automotiva. Analise seu estoque com precisão de engenharia em segundos.
      </p>

      <div className="flex flex-col sm:flex-row gap-6">
        <Link 
          href="/upload" 
          className="bg-primary text-white text-lg px-10 py-5 rounded-full font-black hover:bg-red-600 transition-all hover:scale-105 shadow-2xl shadow-red-500/40 glow-red"
        >
          INICIAR ANÁLISE
        </Link>
        <Link 
          href="/dashboard" 
          className="glass text-white text-lg px-10 py-5 rounded-full font-bold hover:bg-white/10 transition-all hover:scale-105"
        >
          VER ESTOQUE
        </Link>
      </div>

      <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-12 max-w-5xl text-left">
        <div className="space-y-3">
          <h3 className="text-primary font-bold uppercase tracking-widest text-xs">Precisão Visual</h3>
          <p className="text-slate-500 text-sm">Extração automática de acessórios, estado das peças e detalhes de conservação via visão computacional.</p>
        </div>
        <div className="space-y-3">
          <h3 className="text-secondary font-bold uppercase tracking-widest text-xs">Análise de Áudio</h3>
          <p className="text-slate-500 text-sm">Transcrição e interpretação do pitch do vendedor para extrair histórico e bônus mencionados.</p>
        </div>
        <div className="space-y-3">
          <h3 className="text-accent font-bold uppercase tracking-widest text-xs">Insights de Venda</h3>
          <p className="text-slate-500 text-sm">Geração de argumentos persuasivos personalizados para cada veículo em tempo real.</p>
        </div>
      </div>
    </main>
  )
}
