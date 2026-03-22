import { Sidebar } from "@/components/Sidebar";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#efefed]">
      <Sidebar />
      <div className="flex-1 flex flex-col pl-64 min-w-0">
        {children}
      </div>
    </div>
  );
}
