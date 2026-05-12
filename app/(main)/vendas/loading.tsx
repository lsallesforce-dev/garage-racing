export default function VendasLoading() {
  return (
    <div className="flex-1 p-4 md:p-8 animate-pulse space-y-6">
      {/* Cards de resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-3xl p-5 shadow-sm space-y-3">
            <div className="h-3 bg-gray-100 rounded-full w-2/3" />
            <div className="h-7 bg-gray-200 rounded-full w-3/4" />
          </div>
        ))}
      </div>
      {/* Gráfico */}
      <div className="bg-white rounded-3xl p-6 shadow-sm">
        <div className="h-4 bg-gray-200 rounded-full w-40 mb-6" />
        <div className="h-48 bg-gray-100 rounded-2xl" />
      </div>
      {/* Tabela */}
      <div className="bg-white rounded-3xl p-6 shadow-sm space-y-3">
        <div className="h-4 bg-gray-200 rounded-full w-32 mb-4" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
