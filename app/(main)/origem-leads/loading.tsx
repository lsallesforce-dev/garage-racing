export default function OrigemLeadsLoading() {
  return (
    <div className="flex-1 p-4 md:p-8 animate-pulse space-y-5">
      {/* Cabeçalho + seletor de período */}
      <div className="h-10 bg-gray-200 rounded-full w-64" />
      <div className="bg-white rounded-[2rem] p-3 shadow-sm flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 bg-gray-100 rounded-full w-24" />
        ))}
      </div>
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[2rem] p-5 shadow-sm space-y-3">
            <div className="h-4 bg-gray-100 rounded-full w-1/3" />
            <div className="h-6 bg-gray-200 rounded-full w-2/3" />
            <div className="h-2 bg-gray-100 rounded-full w-1/2" />
          </div>
        ))}
      </div>
      {/* Ranking de canais */}
      <div className="bg-white rounded-[2rem] p-6 shadow-sm space-y-3">
        <div className="h-3 bg-gray-200 rounded-full w-40 mb-4" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-gray-100 rounded-2xl" />
        ))}
      </div>
      {/* Gráfico */}
      <div className="bg-white rounded-[2rem] p-6 shadow-sm">
        <div className="h-3 bg-gray-200 rounded-full w-40 mb-6" />
        <div className="h-[260px] bg-gray-100 rounded-2xl" />
      </div>
    </div>
  );
}
