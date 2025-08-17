"use client";

import { useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";

type Row = {
  id: string;
  user_id: string;
  session_date: string; // yyyy-mm-dd
  status: "planned" | "completed" | "skipped";
};

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
  dt.setDate(dt.getDate() + days);
  return ymd(dt);
}
function rangeDays(endISO: string, days: number) {
  return Array.from({ length: days }, (_, i) => addDaysISO(endISO, i - (days - 1)));
}

export default function AthleteStreaks() {
  // Supabase helper (supports getSupabase() or exported supabase)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [byDay, setByDay] = useState<Record<string, { planned: number; completed: number; skipped: number }>>({});
  const [todayISO, setTodayISO] = useState(ymd(new Date()));

  useEffect(() => {
    setTodayISO(ymd(new Date()));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      setLoading(true); setNote("");
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }

        // Pull last 30 days (plus today)
        const end = todayISO;
        const start = addDaysISO(end, -29);

        const { data, error } = await supabase
          .from("training_plan_items")
          .select("id,user_id,session_date,status")
          .eq("user_id", user.id)
          .gte("session_date", start)
          .lte("session_date", end)
          .order("session_date", { ascending: true });

        if (error) throw error;

        const init: Record<string, { planned: number; completed: number; skipped: number }> = {};
        for (const day of rangeDays(end, 30)) init[day] = { planned: 0, completed: 0, skipped: 0 };

        (data || []).forEach((r: Row) => {
          const b = init[r.session_date] || { planned: 0, completed: 0, skipped: 0 };
          if (r.status === "planned") b.planned += 1;
          if (r.status === "completed") b.completed += 1;
          if (r.status === "skipped") b.skipped += 1;
          init[r.session_date] = b;
        });

        setByDay(init);
      } catch (e: any) {
        setNote(e.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase, todayISO]);

  // KPIs
  const today = byDay[todayISO] || { planned: 0, completed: 0, skipped: 0 };

  const last7Days = useMemo(() => {
    const days = rangeDays(todayISO, 7);
    let planned = 0, completed = 0;
    days.forEach(d => {
      const b = byDay[d]; if (!b) return;
      planned += b.planned + b.completed + b.skipped; // total scheduled
      completed += b.completed;
    });
    const rate = planned ? Math.round((completed / planned) * 100) : 0;
    return { planned, completed, rate };
  }, [byDay, todayISO]);

  const streak = useMemo(() => {
    // count consecutive days ending yesterday/today with at least one completed
    let s = 0;
    for (let i = 0; i < 30; i++) {
      const day = addDaysISO(todayISO, -i);
      const b = byDay[day];
      if (b && b.completed > 0) s += 1;
      else break;
    }
    return s;
  }, [byDay, todayISO]);

  // Tiny 14-day bar trend: completion % each day
  const last14 = useMemo(() => {
    const days = rangeDays(todayISO, 14);
    return days.map(d => {
      const b = byDay[d];
      const total = b ? b.planned + b.completed + b.skipped : 0;
      const pct = total ? Math.round((b!.completed / total) * 100) : 0;
      return { day: d, pct };
    });
  }, [byDay, todayISO]);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3" style={{flexWrap:"wrap"}}>
        <h3 className="font-semibold">Streaks & Compliance</h3>
        {loading ? <span className="text-xs" style={{color:"var(--muted)"}}>Loading…</span> : null}
        {note ? <span className="text-xs" style={{color:"#fca5a5"}}>{note}</span> : null}
        <div className="ml-auto text-xs" style={{color:"var(--muted)"}}>{new Date().toLocaleDateString()}</div>
      </div>

      <div className="mt-3 grid sm:grid-cols-3 gap-4">
        {/* Today */}
        <div className="rounded bg-white/5 border border-white/10 p-3">
          <div className="text-xs" style={{color:"var(--muted)"}}>Today</div>
          <div className="text-2xl font-semibold mt-1">
            {today.completed}/{today.planned + today.completed + today.skipped}
          </div>
          <div className="text-xs opacity-70 mt-1">completed</div>
        </div>

        {/* 7-day completion */}
        <div className="rounded bg-white/5 border border-white/10 p-3">
          <div className="text-xs" style={{color:"var(--muted)"}}>Last 7 days</div>
          <div className="text-2xl font-semibold mt-1">{last7Days.rate}%</div>
          <div className="text-xs opacity-70 mt-1">
            {last7Days.completed}/{last7Days.planned} sessions
          </div>
        </div>

        {/* Streak */}
        <div className="rounded bg-white/5 border border-white/10 p-3">
          <div className="text-xs" style={{color:"var(--muted)"}}>Current streak</div>
          <div className="text-2xl font-semibold mt-1">{streak} day{streak===1?"":"s"}</div>
          <div className="text-xs opacity-70 mt-1">with at least one completed session/day</div>
        </div>
      </div>

      {/* Trend bars */}
      <div className="mt-4">
        <div className="text-xs" style={{color:"var(--muted)"}}>14-day completion trend</div>
        <div className="mt-2 flex items-end gap-1" style={{height: 56}}>
          {last14.map(({ day, pct }) => (
            <div key={day} title={`${day}: ${pct}%`}
                 className="w-3 rounded-t"
                 style={{
                   height: Math.max(4, Math.round((pct/100) * 56)),
                   background: `linear-gradient(180deg, rgba(16,185,129,0.95), rgba(16,185,129,0.6))`
                 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
