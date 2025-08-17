"use client";

import { useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";

type Row = {
  plan_item_id: string;
  duration_min: number | null;
  planned_sets: number | null;
  completed_sets: number | null;
  planned_reps: number | null;
  actual_reps: number | null;
  tonnage_kg: number | null;
  strength_avg_rpe: number | null;
  planned_sec: number | null;
  actual_sec: number | null;
  endu_avg_rpe: number | null;
  sets_compliance: number | null;
  time_compliance: number | null;
  sRPE_load: number | null;
};

export default function SessionMetrics({ planItemId }: { planItemId: string }) {
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    return (Supa as any).supabase ?? null;
  }, []);

  const [row, setRow] = useState<Row | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("session_metrics")
          .select("*")
          .eq("plan_item_id", planItemId)
          .single();
        if (error) throw error;
        if (on) setRow(data as Row);
      } catch (e: any) {
        if (on) setErr(e.message ?? String(e));
      }
    })();
    return () => { on = false; };
  }, [supabase, planItemId]);

  if (err) return <div className="text-xs" style={{color:"#fca5a5"}}>{err}</div>;
  if (!row) return <div className="text-sm opacity-70">Loading metrics…</div>;

  const setsPct = row.sets_compliance != null ? Math.round(row.sets_compliance * 100) : null;
  const timePct = row.time_compliance != null ? Math.round(row.time_compliance * 100) : null;

  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {/* Strength */}
      <div className="rounded-xl bg-white/5 p-3">
        <div className="text-xs opacity-70">Strength</div>
        <div className="mt-1 text-lg font-semibold">
          {row.tonnage_kg != null ? `${Math.round(row.tonnage_kg)} kg tonnage` : "—"}
        </div>
        <div className="mt-2 h-2 w-full rounded bg-white/10">
          <div
            className="h-2 rounded"
            style={{ width: `${setsPct ?? 0}%`, background: "var(--pine,#10b981)" }}
            title="Sets compliance"
          />
        </div>
        <div className="mt-1 text-xs opacity-80">
          {row.completed_sets ?? 0}/{row.planned_sets ?? 0} sets done {setsPct!=null ? `(${setsPct}%)` : ""}
        </div>
      </div>

      {/* Endurance */}
      <div className="rounded-xl bg-white/5 p-3">
        <div className="text-xs opacity-70">Endurance</div>
        <div className="mt-1 text-lg font-semibold">
          {row.actual_sec != null ? `${Math.round(row.actual_sec/60)} min done` :
           row.planned_sec != null ? `${Math.round(row.planned_sec/60)} min planned` : "—"}
        </div>
        <div className="mt-2 h-2 w-full rounded bg-white/10">
          <div
            className="h-2 rounded"
            style={{ width: `${timePct ?? 0}%`, background: "var(--pine,#10b981)" }}
            title="Time compliance"
          />
        </div>
        <div className="mt-1 text-xs opacity-80">
          {timePct!=null ? `${timePct}% of planned time` : "no actuals logged yet"}
        </div>
      </div>

      {/* sRPE load */}
      <div className="rounded-xl bg-white/5 p-3">
        <div className="text-xs opacity-70">Training Load (sRPE)</div>
        <div className="mt-1 text-lg font-semibold">
          {row.sRPE_load != null ? Math.round(row.sRPE_load) : "—"}
        </div>
        <div className="mt-1 text-xs opacity-80">
          RPE × minutes (uses endurance or session RPE).
        </div>
      </div>
    </div>
  );
}
