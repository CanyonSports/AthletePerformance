// app/training/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import * as Supa from "@/lib/supabaseClient";
// Safe NavBar import (works whether NavBar is default or named)
import * as NavMod from "@/components/NavBar";
const NavBar: any = (NavMod as any).default ?? (NavMod as any).NavBar ?? (() => null);

type PlanItem = {
  id: string;
  user_id: string;
  sport: "climbing" | "ski" | "mtb" | "running";
  session_date: string;       // yyyy-mm-dd
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

const dayNames = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function startOfWeekISO(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0,0,0,0);
  return x.toISOString().slice(0,10);
}
function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}
function isSameISO(a: string, b: string) { return a === b; }
function toLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function InlineWeekPicker({
  value, onChange, className,
}: { value: string; onChange: (v: string)=>void; className?: string; }) {
  const prev = () => onChange(addDaysISO(value, -7));
  const next = () => onChange(addDaysISO(value, 7));
  const onDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value ? new Date(e.target.value) : new Date();
    onChange(startOfWeekISO(v));
  };
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button className="btn btn-dark" type="button" onClick={prev} aria-label="Previous week">←</button>
      <input type="date" className="field field--date" value={value} onChange={onDate}/>
      <button className="btn btn-dark" type="button" onClick={next} aria-label="Next week">→</button>
      <span className="text-sm" style={{ color: "var(--muted)" }}>
        {value} – {addDaysISO(value,6)}
      </span>
    </div>
  );
}

export default function TrainingPage() {
  const sp = useSearchParams();
  const router = useRouter();

  // Supabase client (works with factory or const export)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [sport, setSport] = useState<PlanItem["sport"]>((sp?.get("sport") as any) || "climbing");
  const [weekStart, setWeekStart] = useState<string>(sp?.get("week") || startOfWeekISO(new Date()));
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"grid"|"list">("grid");

  const todayISO = new Date().toISOString().slice(0,10);
  const todayColRef = useRef<HTMLDivElement | null>(null);

  // Build the week days once per weekStart
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)),
    [weekStart]
  );

  // Group items by day for grid view
  const byDay = useMemo(() => {
    const map: Record<string, PlanItem[]> = {};
    for (const iso of weekDays) map[iso] = [];
    for (const it of items) (map[it.session_date] ||= []).push(it);
    // sort: planned first, then completed, then skipped
    for (const iso of Object.keys(map)) {
      map[iso].sort((a,b) => {
        const order = (s: PlanItem["status"]) => (s === "planned" ? 0 : s === "completed" ? 1 : 2);
        return order(a.status) - order(b.status);
      });
    }
    return map;
  }, [items, weekDays]);

  // Overall progress
  const completed = items.filter(i => i.status === "completed").length;
  const pct = items.length ? Math.round((100 * completed) / items.length) : 0;

  // Load my week
  const loadWeek = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) return;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const end = addDaysISO(weekStart, 7);
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("user_id", user.id)
        .eq("sport", sport)
        .gte("session_date", weekStart)
        .lt("session_date", end)
        .order("session_date", { ascending: true });
      if (error) throw error;
      setItems((data || []) as PlanItem[]);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally { setLoading(false); }
  }, [isConfigured, supabase, router, sport, weekStart]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  // Realtime refresh
  useEffect(() => {
    if (!isConfigured || !supabase) return;
    let mounted = true;
    let channel: any = null;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        channel = supabase.channel(`training-${sport}`)
          .on("postgres_changes", {
            event: "*", schema: "public", table: "training_plan_items",
            filter: `user_id=eq.${user.id}`
          }, () => { if (mounted) loadWeek(); })
          .subscribe();
      } catch {}
    })();
    return () => {
      mounted = false;
      try { if (channel) { supabase.removeChannel(channel); channel?.unsubscribe?.(); } } catch {}
    };
  }, [isConfigured, supabase, sport, loadWeek]);

  // Optimistic actions
  const cycleStatus = (current: PlanItem["status"]): PlanItem["status"] =>
    current === "planned" ? "completed" : current === "completed" ? "skipped" : "planned";

  async function updateStatus(id: string, current: PlanItem["status"]) {
    if (!isConfigured || !supabase) return;
    const next = cycleStatus(current);
    setItems(prev => prev.map(it => it.id === id ? { ...it, status: next } : it));
    const { error } = await supabase.from("training_plan_items").update({ status: next }).eq("id", id);
    if (error) {
      // revert on failure
      setItems(prev => prev.map(it => it.id === id ? { ...it, status: current } : it));
      setNote(error.message);
    }
  }
  async function setRpe(id: string, rpe: number | null) {
    if (!isConfigured || !supabase) return;
    const prev = items.find(i => i.id === id)?.rpe ?? null;
    setItems(xs => xs.map(it => it.id === id ? ({ ...it, rpe }) : it));
    const { error } = await supabase.from("training_plan_items").update({ rpe }).eq("id", id);
    if (error) {
      setItems(xs => xs.map(it => it.id === id ? ({ ...it, rpe: prev }) : it));
      setNote(error.message);
    }
  }

  // Auto-scroll the grid to today's column on mount/when week changes
  useEffect(() => {
    if (todayColRef.current && weekDays.includes(todayISO)) {
      todayColRef.current.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [todayISO, weekDays]);

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <NavBar />

      {/* Header */}
      <div className="card p-4 mt-6">
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <div>
            <h2 className="text-xl font-semibold">My Training</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Tap a session card to open the workout. Status cycles (Planned → Completed → Skipped). RPE inline.
            </p>
            {note ? <p className="text-xs" style={{ color: "#fca5a5", marginTop: 6 }}>{note}</p> : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <select className="field" value={sport} onChange={e => setSport(e.target.value as any)}>
              <option value="climbing">Climbing</option>
              <option value="ski">Ski</option>
              <option value="mtb">MTB</option>
              <option value="running">Running</option>
            </select>

            <InlineWeekPicker value={weekStart} onChange={setWeekStart} />

            <div className="hidden sm:flex items-center gap-1 ml-2 bg-white/5 border border-white/10 rounded">
              <button
                type="button"
                className={`px-3 py-2 text-sm ${view==="grid" ? "bg-white/10" : ""}`}
                onClick={() => setView("grid")}
                aria-pressed={view==="grid"}
              >Grid</button>
              <button
                type="button"
                className={`px-3 py-2 text-sm ${view==="list" ? "bg-white/10" : ""}`}
                onClick={() => setView("list")}
                aria-pressed={view==="list"}
              >List</button>
            </div>
          </div>

          {/* progress bar */}
          <div className="w-full mt-4">
            <div className="h-2 w-full rounded bg-white/10">
              <div className="h-2 rounded" style={{ width: `${pct}%`, background: "var(--pine, #ef4444)" }} />
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              {completed}/{items.length} completed
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="card p-6 mt-6">Loading…</div>
      ) : items.length === 0 && view === "list" ? (
        <div className="card p-6 mt-6" style={{ color: "var(--muted)" }}>
          No sessions for this week.
        </div>
      ) : view === "list" ? (
        // ---------- LIST VIEW ----------
        <div className="mt-6 flex flex-col gap-4">
          {weekDays.map((iso) => {
            const dayItems = byDay[iso] || [];
            return (
              <div key={iso} className="card p-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{toLabel(iso)}</h3>
                  {isSameISO(iso, todayISO) && <span className="badge">Today</span>}
                </div>
                {dayItems.length === 0 ? (
                  <div className="text-sm mt-2" style={{ color: "var(--muted)" }}>Rest / No sessions.</div>
                ) : (
                  <div className="mt-3 flex flex-col gap-3">
                    {dayItems.map((it) => (
                      <div
                        key={it.id}
                        className="card p-3 cursor-pointer"
                        onClick={() => router.push(`/training/session/${it.id}`)}
                        title="Open workout"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            className="btn btn-dark"
                            type="button"
                            onClick={(e) => { e.stopPropagation(); updateStatus(it.id, it.status); }}
                            title="Cycle status"
                          >
                            {it.status === "completed" ? "✓" : it.status === "skipped" ? "–" : "•"} {it.status}
                          </button>
                          <span className="font-medium truncate underline-offset-2 hover:underline">
                            {it.title}
                          </span>
                          <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
                            {it.duration_min != null ? `${it.duration_min} min` : "—"}
                          </div>
                        </div>
                        {it.details && <div className="text-sm mt-1 whitespace-pre-wrap">{it.details}</div>}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs" style={{ color: "var(--muted)" }}>RPE:</span>
                          <input
                            className="field w-20"
                            type="number"
                            min={1} max={10}
                            placeholder="1–10"
                            value={it.rpe ?? ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={e => setRpe(it.id, e.target.value === "" ? null : Number(e.target.value))}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        // ---------- GRID VIEW ----------
        <div className="mt-6 overflow-x-auto">
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))", minWidth: 900 }}
          >
            {weekDays.map((iso) => {
              const dayItems = byDay[iso] || [];
              const isToday = isSameISO(iso, todayISO);
              return (
                <div
                  key={iso}
                  ref={isToday ? todayColRef : null}
                  className="card p-3 flex flex-col"
                  style={{
                    outline: isToday ? "1px solid var(--pine, #ef4444)" : "none",
                    boxShadow: isToday ? "inset 0 0 0 1px rgba(239,68,68,0.35)" : "none"
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold">{dayNames[weekDays.indexOf(iso)]}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>{toLabel(iso)}</div>
                    {isToday && <span className="badge ml-auto">Today</span>}
                  </div>

                  <div className="mt-2 flex-1 flex flex-col gap-2">
                    {dayItems.length === 0 ? (
                      <div className="text-xs" style={{ color: "var(--muted)" }}>Rest / —</div>
                    ) : dayItems.map((it) => (
                      <div
                        key={it.id}
                        className="rounded p-2 text-left border border-white/10 cursor-pointer hover:bg-white/5"
                        onClick={() => router.push(`/training/session/${it.id}`)}
                        title="Open workout"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            className="inline-block w-2 h-2 rounded-full"
                            style={{
                              background:
                                it.status === "completed" ? "var(--pine, #ef4444)" :
                                it.status === "skipped" ? "#6b7280" : "#9ca3af"
                            }}
                            onClick={(e) => { e.stopPropagation(); updateStatus(it.id, it.status); }}
                            title="Cycle status"
                          />
                          <span className="font-medium truncate underline-offset-2 hover:underline">
                            {it.title}
                          </span>
                          <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
                            {it.duration_min != null ? `${it.duration_min}m` : "—"}
                          </div>
                        </div>
                        {it.details && (
                          <div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: "var(--muted)" }}>
                            {it.details}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[11px]" style={{ color: "var(--muted)" }}>RPE</span>
                          <input
                            className="field w-16"
                            type="number"
                            min={1} max={10}
                            placeholder="1–10"
                            value={it.rpe ?? ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={e => setRpe(it.id, e.target.value === "" ? null : Number(e.target.value))}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
