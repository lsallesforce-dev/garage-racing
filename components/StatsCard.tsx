"use client";

import { ArrowUpRight, ArrowDownRight } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  change: number;
  icon?: React.ReactNode;
  timeframe?: string;
  isNegative?: boolean;
}

export const StatsCard = ({ 
  title, 
  value, 
  change, 
  icon, 
  timeframe = "vs last month", 
  isNegative = false 
}: StatsCardProps) => {
  return (
    <div className="bg-white p-6 rounded-sm shadow-sm border border-gray-100 flex flex-col justify-between h-44">
      <div className="flex justify-between items-start">
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-none">
          {title}
        </h3>
        {icon && <div className="text-gray-200">{icon}</div>}
      </div>
      
      <div className="mt-4">
        <p className="text-4xl font-black text-gray-900 tracking-tight leading-none">
          {value}
        </p>
      </div>

      <div className="mt-auto flex items-center gap-2">
        <div className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${isNegative ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {isNegative ? <ArrowDownRight size={10} /> : <ArrowUpRight size={10} />}
          {change}%
        </div>
        <span className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">{timeframe}</span>
      </div>
    </div>
  );
};
