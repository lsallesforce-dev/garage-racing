export default function ChatLoading() {
  return (
    <div className="flex-1 flex h-screen animate-pulse overflow-hidden">
      {/* Lista de leads */}
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <div className="h-9 bg-gray-100 rounded-xl" />
        </div>
        <div className="flex-1 overflow-hidden p-2 space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-2xl">
              <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-gray-200 rounded-full w-3/4" />
                <div className="h-2.5 bg-gray-100 rounded-full w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Área de mensagens */}
      <div className="flex-1 flex flex-col bg-[#efefed]">
        <div className="h-16 bg-white border-b border-gray-200" />
        <div className="flex-1 p-6 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
              <div className={`h-10 bg-gray-200 rounded-2xl ${i % 2 === 0 ? "w-56" : "w-44"}`} />
            </div>
          ))}
        </div>
        <div className="h-16 bg-white border-t border-gray-200" />
      </div>
    </div>
  );
}
