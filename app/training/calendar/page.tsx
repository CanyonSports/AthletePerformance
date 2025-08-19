// app/training/calendar/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { getSupabase } from "@/lib/supabaseClient";
import { ChevronLeft, ChevronRight, Calendar, CheckCircle2, XCircle, Circle, Trash2 } from "lucide-react";

/* ------------------------------ Types ------------------------------ */
type PlanItem = {
  id: string;
  user_id: string;
  session_date: string; // yyyy-mm-dd
  title: string;
  details: any | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

/* -------------------------- Local date utils ------------------------- */
const ymd = (d: Date) => {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addDays = (d: Date, days: number) => { const x = new Date(d); x.setDate(x.getDate() + days); return x; };
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfWeekMonday = (d: Date) => { const x = new Date(d); const weekday = (x.getDay() + 6) % 7; x.setDate(x.getDate() - weekday); x.setHours(0,0,0,0); return x; };
const monthGridDays = (d: Date) => { const first = startOfMonth(d); const gridStart = startOfWeekMonday(first); return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)); };

/* ------------------------------ Component --------------------------- */
export default function TrainingCalendarPage() {
  const supabase = useMemo(() => { try { return getSupabase(); } catch { return null; } }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  const [cursor, setCursor] = useState<Date>(() => { const t = new Date(); t.setHours(0,0,0,0); return t; });
  const [selectedISO, setSelectedISO] = useState<string>(() => ymd(new Date()));
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PlanItem[]>([]);

  const todayISO = useMemo(() => ymd(new Date()), []);
  const gridDays = useMemo(() => monthGridDays(cursor), [cursor]);
  const firstISO = useMemo(() => ymd(gridDays[0]), [gridDays]);
  const lastISO = useMemo(() => ymd(gridDays[gridDays.length - 1]), [gridDays]);

  /* ------------------------------- Data IO ------------------------------ */
  const loadUser = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (user) setUserId(user.id);
    } catch (e) { setNote(String(e)); }
  }, [isConfigured, supabase]);

  const loadItems = useCallback(async () => {
    if (!isConfigured || !supabase || !userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("id,user_id,session_date,title,details,duration_min,rpe,status,created_at")
        .eq("user_id", userId)
        .gte("session_date", firstISO)
        .lte("session_date", lastISO);
      if (error) throw error;
      setItems((data ?? []) as PlanItem[]);
    } catch (e) { setNote(String(e)); }
    finally { setLoading(false); }
  }, [isConfigured, supabase, userId, firstISO, lastISO]);

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    if (!isConfigured || !supabase || !userId) return;
    const ch = supabase
      .channel("athlete-calendar")
      .on("postgres_changes", { event: "*", schema: "public", table: "training_plan_items", filter: `user_id=eq.${userId}` }, loadItems)
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [isConfigured, supabase, userId, loadItems]);

  /* ------------------------------ Derived ------------------------------ */
  const itemsByDay = useMemo(() => {
    const map: Record<string, PlanItem[]> = {};
    for (const it of items) {
      const k = it.session_date;
      if (!map[k]) map[k] = [];
      map[k].push(it);
    }
    Object.keys(map).forEach((k) =>
      map[k].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "") || a.title.localeCompare(b.title))
    );
    return map;
  }, [items]);

  const monthName = useMemo(() => cursor.toLocaleString(undefined, { month: "long", year: "numeric" }), [cursor]);

  /* ------------------------------- Actions ------------------------------ */
  const gotoPrevMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const gotoNextMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
  const gotoToday = () => { const t = new Date(); t.setHours(0,0,0,0); setCursor(new Date(t.getFullYear(), t.getMonth(), 1)); setSelectedISO(ymd(t)); };

  const markStatus = async (id: string, status: PlanItem["status"]) => {
    if (!isConfigured || !supabase) return;
    try {
      const { error } = await supabase.from("training_plan_items").update({ status }).eq("id", id);
      if (error) throw error;
      loadItems();
    } catch (e) { setNote(String(e)); }
  };

  // NEW: delete a single item
  const deleteItem = async (id: string) => {
    if (!isConfigured || !supabase) return;
    if (!confirm("Delete this workout?")) return;
    try {
      const { error } = await supabase.from("training_plan_items").delete().eq("id", id);
      if (error) throw error;
      loadItems();
    } catch (e) { setNote(String(e)); }
  };

  // NEW: delete all items on the selected day
  const deleteAllOnDay = async (iso: string) => {
    if (!isConfigured || !supabase || !userId) return;
    if (!confirm(`Delete all workouts on ${new Date(iso).toLocaleDateString()}?`)) return;
    try {
      const { error } = await supabase
        .from("training_plan_items")
        .delete()
        .eq("user_id", userId)
        .eq("session_date", iso);
      if (error) throw error;
      loadItems();
    } catch (e) { setNote(String(e)); }
  };

  /* ------------------------------ Render ------------------------------ */
  const WeekdayHeader = () => (
    <div className="grid grid-cols-7 gap-1 text-xs md:text-sm" style={{ color: "var(--muted)" }}>
      {"Mon Tue Wed Thu Fri Sat Sun".split(" ").map((d) => (
        <div key={d} className="px-2 py-1 text-center">{d}</div>
      ))}
    </div>
  );

  const DayCell: React.FC<{ day: Date }> = ({ day }) => {
    const iso = ymd(day);
    const inMonth = day.getMonth() === cursor.getMonth();
    const isToday = iso === todayISO;
    const isSelected = iso === selectedISO;
    const dayItems = itemsByDay[iso] || [];

    const cntCompleted = dayItems.filter((x) => x.status === "completed").length;
    const cntSkipped = dayItems.filter((x) => x.status === "skipped").length;
    const cntPlanned = dayItems.filter((x) => x.status === "planned").length;

    return (
      <button
        onClick={() => setSelectedISO(iso)}
        className={`relative h-28 md:h-32 w-full rounded-lg border text-left p-2 transition ${inMonth ? "" : "opacity-50"} ${isSelected ? "ring-2 ring-blue-400" : ""}`}
        style={{ borderColor: "#ffffff1a", background: "#0f1320" }}
      >
        <div className="flex items-center justify-between">
          <div className="text-xs opacity-80">{day.getDate()}</div>
          {isToday ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#10b98122", color: "#10b981" }}>
              Today
            </span>
          ) : null}
        </div>
        <div className="mt-1 space-y-1">
          {dayItems.slice(0, 3).map((it) => (
            <Link
              key={it.id}
              href={`/training/session/${it.id}`}
              className="block truncate text-xs rounded px-2 py-1"
              style={{ background: tagBg(it.status), color: tagFg(it.status) }}
              title={it.title}
            >
              {iconFor(it.status)} {it.title}
            </Link>
          ))}
          {dayItems.length > 3 ? <div className="text-[11px] opacity-70">+{dayItems.length - 3} more…</div> : null}
        </div>

        {dayItems.length > 0 ? (
          <div className="absolute bottom-1 left-0 right-0 px-2 text-[10px] flex items-center gap-2 opacity-80">
            {cntCompleted > 0 ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{cntCompleted}</span> : null}
            {cntPlanned > 0 ? <span className="inline-flex items-center gap-1"><Circle className="w-3 h-3" />{cntPlanned}</span> : null}
            {cntSkipped > 0 ? <span className="inline-flex items-center gap-1"><XCircle className="w-3 h-3" />{cntSkipped}</span> : null}
          </div>
        ) : null}
      </button>
    );
  };

  const selectedItems = itemsByDay[selectedISO] || [];

  return (
    <div className="max-w-7xl mx-auto pb-16">
      <NavBar />

      {/* Header */}
      <div className="mt-4 rounded-2xl p-5 md:p-6" style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
        <div className="flex items-start gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Training Calendar</h1>
            <p className="text-sm md:text-base mt-1" style={{ color: "var(--muted)" }}>
              See your plan at a glance. Click a session to open it.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/training" className="btn">Week View</Link>
            <button className="btn" onClick={gotoToday}>Today</button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button className="btn btn-dark" onClick={gotoPrevMonth} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
          <div className="px-3 py-2 rounded card inline-flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            <span className="font-medium">{monthName}</span>
          </div>
          <button className="btn btn-dark" onClick={gotoNextMonth} aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
          {loading ? <span className="text-xs" style={{ color: "var(--muted)" }}>Loading…</span> : null}
          {note ? <span className="text-xs" style={{ color: "#fca5a5" }}>{note}</span> : null}
        </div>
      </div>

      {/* Calendar + Day Drawer */}
      <div className="mt-6 grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <WeekdayHeader />
          <div className="mt-1 grid grid-cols-7 gap-1">
            {gridDays.map((d) => (<DayCell key={ymd(d)} day={d} />))}
          </div>
        </div>

        {/* Day details panel */}
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{new Date(selectedISO).toLocaleDateString()}</h3>
            <button className="btn btn-dark ml-auto" onClick={() => deleteAllOnDay(selectedISO)}>
              <Trash2 className="w-4 h-4 mr-1" /> Delete day
            </button>
          </div>

          {selectedItems.length === 0 ? (
            <div className="mt-2 text-sm" style={{ color: "var(--muted)" }}>No sessions planned.</div>
          ) : (
            <div className="mt-3 space-y-2">
              {selectedItems.map((it) => (
                <div key={it.id} className="rounded bg-white/5 p-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center text-xs px-2 py-0.5 rounded" style={{ background: tagBg(it.status), color: tagFg(it.status) }}>
                      {iconFor(it.status)} {it.status}
                    </span>
                    <Link href={`/training/session/${it.id}`} className="ml-auto btn">Open</Link>
                    <button className="btn btn-dark" onClick={() => deleteItem(it.id)} title="Delete workout">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mt-2 font-medium">{it.title}</div>
                  {it.details ? (
                    <div className="text-sm opacity-90 mt-1 whitespace-pre-wrap line-clamp-4">{typeof it.details === "string" ? it.details : JSON.stringify(it.details, null, 2)}</div>
                  ) : null}
                  <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                    {it.duration_min ? <span>{it.duration_min} min</span> : null}
                    {it.rpe ? <span className="ml-2">RPE {it.rpe}</span> : null}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    {it.status !== "completed" ? (
                      <button className="btn" onClick={() => markStatus(it.id, "completed")}>Mark Completed</button>
                    ) : (
                      <button className="btn" onClick={() => markStatus(it.id, "planned")}>Undo Complete</button>
                    )}
                    {it.status !== "skipped" ? (
                      <button className="btn" onClick={() => markStatus(it.id, "skipped")}>Skip</button>
                    ) : (
                      <button className="btn" onClick={() => markStatus(it.id, "planned")}>Undo Skip</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Styling helpers ------------------------------ */
const tagBg = (status: PlanItem["status"]) => status === "completed" ? "#10b98122" : status === "skipped" ? "#ef444422" : "#6b728022";
const tagFg = (status: PlanItem["status"]) => status === "completed" ? "#10b981" : status === "skipped" ? "#ef4444" : "#9ca3af";
const iconFor = (status: PlanItem["status"]) => status === "completed" ? <CheckCircle2 className="w-3 h-3 inline" /> : status === "skipped" ? <XCircle className="w-3 h-3 inline" /> : <Circle className="w-3 h-3 inline" />;
