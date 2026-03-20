import React from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon?: React.ReactNode;
}

export const StatsCard = ({ title, value, change, icon }: StatsCardProps) => (
  <div className="bg-[#161616] border border-white/5 p-6 rounded-2xl shadow-2xl relative overflow-hidden group hover:border-white/10 transition-all duration-500">
    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
      {icon}
    </div>
    
    <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">{title}</p>
    
    <div className="flex items-end justify-between">
      <h3 className="text-3xl font-black text-white tracking-tighter">{value}</h3>
      {change !== undefined && (
        <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${
          change >= 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
        }`}>
          <span>{change >= 0 ? '↑' : '↓'}</span>
          <span>{Math.abs(change)}%</span>
        </div>
      )}
    </div>

    <div className="mt-4 h-1 w-full bg-white/5 rounded-full overflow-hidden">
        <div 
            className={`h-full rounded-full transition-all duration-1000 ${change && change > 0 ? 'bg-primary' : 'bg-accent'}`} 
            style={{ width: '65%' }}
        ></div>
    </div>
  </div>
);
