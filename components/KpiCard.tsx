// components/KpiCard.tsx
"use client";
import { ReactNode } from "react";
import Sparkline from "@/components/Sparkline";

export default function KpiCard({ title, value, sub, series, labels, icon }: {
  title: string;
  value: string | number | null;
  sub?: string;
  series?: (number|null)[];
  labels?: string[];
  icon?: ReactNode;
}) {
  const display = (v: any) => {
    if (v === null || v === undefined) return "No Data";
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "No Data";
  };

  return (
    <div className="card p-4 kpi">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-300">{title}</p>
        {icon}
      </div>
      <p className="text-4xl font-semibold tracking-tight mt-1">{display(value)}</p>
      {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
      {series && labels ? <div className="mt-2"><Sparkline data={series} labels={labels} /></div> : null}
    </div>
  );
}
