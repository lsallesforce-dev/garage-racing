export default function EstoqueLoading() {
  return (
    <div className="flex-1 p-4 md:p-8 animate-pulse">
      {/* Barra de busca + botões */}
      <div className="flex gap-3 mb-6">
        <div className="h-10 bg-gray-200 rounded-2xl flex-1" />
        <div className="h-10 w-32 bg-gray-200 rounded-2xl" />
        <div className="h-10 w-32 bg-gray-200 rounded-2xl" />
      </div>
      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white rounded-3xl overflow-hidden shadow-sm">
            <div className="h-44 bg-gray-200" />
            <div className="p-4 space-y-2">
              <div className="h-4 bg-gray-200 rounded-full w-3/4" />
              <div className="h-3 bg-gray-100 rounded-full w-1/2" />
              <div className="h-5 bg-gray-200 rounded-full w-2/5 mt-3" />
              <div className="flex gap-2 mt-3">
                <div className="h-8 bg-gray-100 rounded-xl flex-1" />
                <div className="h-8 w-8 bg-gray-100 rounded-xl" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
