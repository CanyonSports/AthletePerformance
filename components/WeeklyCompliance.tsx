"use client";

import { useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";

type Row = {
  week_start: string;
  sessions: number;
  strength_tonnage_kg: number | null;
  avg_sets_compliance: number | null;
  endurance_seconds: number | null;
  avg_time_compliance: number | null;
  sum_sRPE_load: number | null;
};

export default function WeeklyCompliance({ userId }: { userId?: string }) {
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    return (Supa as any).supabase ?? null;
  }, []);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        let query = supabase.from("weekly_metrics").select("*").order("week_start", { ascending: false }).limit(8);
        if (userId) query = query.eq("user_id", userId);
        const { data, error } = await query;
        if (error) throw error;
        if (on) setRows((data ?? []) as Row[]);
      } catch (e: any) {
        if (on) setErr(e.message ?? String(e));
      }
    })();
    return () => { on = false; };
  }, [supabase, userId]);

  if (err) return <div className="text-xs" style={{ color: "#fca5a5" }}>{err}</div>;
  if (!rows.length) return <div className="text-sm opacity-70">No recent training weeks.</div>;

  return (
    <div className="rounded-xl bg-white/5 p-3">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">Weekly Compliance</div>
        <div className="ml-auto text-xs opacity-80">Last {rows.length} weeks</div>
      </div>
      <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map(r => {
          const setsPct  = r.avg_sets_compliance != null ? Math.round(r.avg_sets_compliance * 100) : null;
          const timePct  = r.avg_time_compliance != null ? Math.round(r.avg_time_compliance * 100) : null;
          const label = new Date(r.week_start).toLocaleDateString();
          return (
            <div key={r.week_start} className="rounded-lg bg-white/5 p-3">
              <div className="text-xs opacity-70">{label}</div>
              <div className="mt-1 text-lg font-semibold">{r.sessions} sessions</div>
              <div className="mt-2 h-2 w-full rounded bg-white/10">
                <div className="h-2 rounded" style={{ width: `${setsPct ?? 0}%`, background: "var(--pine,#10b981)" }} title="Avg sets compliance" />
              </div>
              <div className="mt-1 text-xs opacity-80">Strength: {setsPct!=null ? `${setsPct}%` : "—"} • {Math.round(r.strength_tonnage_kg ?? 0)} kg</div>
              <div className="mt-1 h-2 w-full rounded bg-white/10">
                <div className="h-2 rounded" style={{ width: `${timePct ?? 0}%`, background: "var(--pine,#10b981)" }} title="Avg time compliance" />
              </div>
              <div className="mt-1 text-xs opacity-80">Endurance: {timePct!=null ? `${timePct}%` : "—"} • {Math.round((r.endurance_seconds ?? 0)/60)} min</div>
              <div className="mt-1 text-xs opacity-80">sRPE load: {Math.round(r.sum_sRPE_load ?? 0)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
