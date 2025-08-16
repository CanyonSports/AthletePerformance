// app/training/history/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as Supa from "@/lib/supabaseClient";
import * as NavMod from "@/components/NavBar";

const NavBar: any = (NavMod as any).default ?? (NavMod as any).NavBar ?? (() => null);

type PlanItem = {
  id: string;
  user_id: string;
  sport: "climbing" | "ski" | "mtb" | "running";
  session_date: string; // yyyy-mm-dd
  title: string;
  details: string | null;
  duration_min: number | null;
  status: "planned" | "completed" | "skipped";
};

type Exercise = {
  id: string;
  plan_item_id: string;
  name: string;
  exercise_key: string | null;
};

type SetRow = {
  id: string;
  exercise_id: string;
  actual_reps: number | null;
  actual_weight_kg: number | null;
  completed: boolean;
};

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromYMD(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}
function addDaysISO(iso: string, days: number) {
  const d = fromYMD(iso);
  d.setDate(d.getDate() + days);
  return ymd(d);
}
function startOfWeekISO_local(d: Date) {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (copy.getDay() + 6) % 7; // Monday=0
  copy.setDate(copy.getDate() - day);
  return ymd(copy);
}
function weekKey(iso: string) {
  const start = startOfWeekISO_local(fromYMD(iso));
  return start; // yyyy-mm-dd for week start
}

export default function TrainingHistoryPage() {
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [rangeEnd] = useState<string>(ymd(new Date()));            // today
  const [rangeStart] = useState<string>(() => addDaysISO(ymd(new Date()), -7 * 8)); // last 8 weeks

  const [sessions, setSessions] = useState<PlanItem[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [sets, setSets] = useState<SetRow[]>([]);

  const loadAll = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    setNote("");
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }

      // sessions in range
      const sQ = supabase
        .from("training_plan_items")
        .select("*")
        .eq("user_id", user.id)
        .gte("session_date", rangeStart)
        .lte("session_date", rangeEnd)
        .order("session_date", { ascending: true });

      const sRes = await sQ;
      if (sRes.error) throw sRes.error;
      const sess = (sRes.data || []) as PlanItem[];
      setSessions(sess);

      // exercises for those sessions
      const ids = sess.map(s => s.id);
      if (!ids.length) { setExercises([]); setSets([]); setLoading(false); return; }

      const eRes = await supabase
        .from("training_exercises")
        .select("id,plan_item_id,name,exercise_key")
        .in("plan_item_id", ids)
        .order("plan_item_id", { ascending: true });
      if (eRes.error) throw eRes.error;
      const exs = (eRes.data || []) as any[];
      setExercises(exs);

      // sets for those exercises
      const eids = exs.map(e => e.id);
      const rRes = await supabase
        .from("training_sets")
        .select("id,exercise_id,actual_reps,actual_weight_kg,completed")
        .in("exercise_id", eids);
      if (rRes.error) throw rRes.error;
      setSets((rRes.data || []) as any[]);
    } catch (e:any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, rangeStart, rangeEnd]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // --- Metrics ---
  const byWeek = useMemo(() => {
    const map = new Map<string, PlanItem[]>();
    for (const s of sessions) {
      const k = weekKey(s.session_date);
      map.set(k, [...(map.get(k) || []), s]);
    }
    return Array.from(map.entries()) // [ [weekStart, sessions[]], ... ]
      .sort((a,b) => a[0] < b[0] ? -1 : 1);
  }, [sessions]);

  const completedSessions = useMemo(
    () => sessions.filter(s => s.status === "completed").length,
    [sessions]
  );

  const sessionCompliance = useMemo(() => {
    const planned = sessions.length;
    if (!planned) return 0;
    return Math.round((completedSessions / planned) * 100);
  }, [sessions, completedSessions]);

  const setTotals = useMemo(() => {
    const setCount = sets.length;
    const done = sets.filter(s => s.completed).length;
    const pct = setCount ? Math.round((done / setCount) * 100) : 0;
    return { setCount, done, pct };
  }, [sets]);

  // PRs per exercise_key (or fallback to name)
  const prs = useMemo(() => {
    // map key -> max weight encountered (from actual_weight_kg)
    const exById = new Map(exercises.map(e => [e.id, e]));
    const maxMap = new Map<string, number>();
    for (const r of sets) {
      const ex = exById.get(r.exercise_id);
      if (!ex) continue;
      const key = (ex.exercise_key || ex.name || ex.id).toString().toLowerCase();
      const w = r.actual_weight_kg ?? 0;
      if (w > 0) {
        maxMap.set(key, Math.max(maxMap.get(key) ?? 0, w));
      }
    }
    return Array.from(maxMap.entries())
      .sort((a,b) => a[0].localeCompare(b[0]));
  }, [exercises, sets]);

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <NavBar />

      <div className="mt-6 card p-4">
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <h1 className="text-xl font-semibold">History & Stats</h1>
          <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>
            Range: {new Date(fromYMD(rangeStart)).toLocaleDateString()} → {new Date(fromYMD(rangeEnd)).toLocaleDateString()}
          </div>
        </div>
        {note && <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div>}

        {/* KPIs */}
        <div className="mt-4 grid grid-3">
          <div className="card p-3">
            <div className="text-xs opacity-70">Session Compliance</div>
            <div className="text-2xl font-semibold mt-1">{sessionCompliance}%</div>
            <div className="text-xs opacity-70 mt-1">{completedSessions}/{sessions.length} sessions completed</div>
            <div className="w-full h-2 bg-white/10 rounded mt-2 overflow-hidden">
              <div className="h-full bg-white/50" style={{ width: `${sessionCompliance}%` }} />
            </div>
          </div>

          <div className="card p-3">
            <div className="text-xs opacity-70">Set Completion</div>
            <div className="text-2xl font-semibold mt-1">{setTotals.pct}%</div>
            <div className="text-xs opacity-70 mt-1">{setTotals.done}/{setTotals.setCount} sets complete</div>
            <div className="w-full h-2 bg-white/10 rounded mt-2 overflow-hidden">
              <div className="h-full bg-white/50" style={{ width: `${setTotals.pct}%` }} />
            </div>
          </div>

          <div className="card p-3">
            <div className="text-xs opacity-70">Recent PRs</div>
            <div className="text-2xl font-semibold mt-1">{prs.length}</div>
            <div className="text-xs opacity-70 mt-1">Based on logged actual weights</div>
          </div>
        </div>

        {/* PR list */}
        <div className="mt-4 card p-3">
          <div className="flex items-center">
            <h3 className="font-semibold">Personal Bests</h3>
          </div>
          {prs.length === 0 ? (
            <div className="text-sm opacity-70 mt-2">No PRs yet. Log actual weights to populate PRs.</div>
          ) : (
            <div className="mt-2 grid grid-3">
              {prs.map(([key, kg]) => (
                <div key={key} className="rounded border border-white/10 p-2">
                  <div className="text-xs opacity-70">{key}</div>
                  <div className="text-lg font-semibold">{kg.toFixed(1)} kg</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* By-week timeline */}
        <div className="mt-4">
          <h3 className="font-semibold">Timeline (8 weeks)</h3>
          {loading ? (
            <div className="mt-2">Loading…</div>
          ) : byWeek.length === 0 ? (
            <div className="mt-2 text-sm opacity-70">No sessions in this range.</div>
          ) : (
            <div className="mt-2 space-y-4">
              {byWeek.map(([wkStart, list]) => {
                // simple weekly completion chip
                const done = list.filter(s => s.status === "completed").length;
                const pct = Math.round((done / list.length) * 100);
                const label = (() => {
                  const first = fromYMD(wkStart);
                  const last = addDaysISO(wkStart, 6);
                  const lf = fromYMD(last);
                  const sameMonth = first.getMonth() === lf.getMonth();
                  const mm1 = first.toLocaleDateString(undefined, { month: "short" });
                  const mm2 = lf.toLocaleDateString(undefined, { month: "short" });
                  const d1 = first.getDate(), d2 = lf.getDate();
                  return sameMonth ? `${mm1} ${d1}–${d2}` : `${mm1} ${d1} – ${mm2} ${d2}`;
                })();
                return (
                  <div key={wkStart} className="card p-3">
                    <div className="flex items-center">
                      <div className="font-semibold">{label}</div>
                      <div className="ml-auto text-xs opacity-70">{done}/{list.length} complete</div>
                    </div>
                    <div className="mt-2 grid grid-2">
                      {list.map(s => (
                        <Link key={s.id} href={`/training/session/${s.id}`} className="rounded border border-white/10 p-2 hover:bg-white/5 transition">
                          <div className="flex items-center gap-2">
                            <div className="text-xs px-2 py-0.5 rounded bg-white/10">{s.sport.toUpperCase()}</div>
                            <div className="font-medium truncate">{s.title || "Session"}</div>
                            <div className="ml-auto text-xs opacity-70">
                              {new Date(fromYMD(s.session_date)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                            </div>
                          </div>
                          <div className="text-xs mt-1 opacity-70">
                            Status: {s.status === "completed" ? "✅ Completed" : s.status === "skipped" ? "⏭ Skipped" : "Planned"}
                          </div>
                        </Link>
                      ))}
                    </div>
                    <div className="w-full h-2 bg-white/10 rounded mt-3 overflow-hidden">
                      <div className="h-full bg-white/50" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4">
          <Link href="/training" className="btn">← Back to Today</Link>
        </div>
      </div>
    </div>
  );
}
