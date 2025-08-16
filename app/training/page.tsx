// app/training/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";
import * as NavMod from "@/components/NavBar";
import TodayStrip from "@/components/TodayStrip";
import Link from "next/link";

const NavBar: any = (NavMod as any).default ?? (NavMod as any).NavBar ?? (() => null);

type PlanItem = {
  id: string;
  user_id: string;
  sport: "climbing" | "ski" | "mtb" | "running";
  session_date: string; // yyyy-mm-dd
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
};

/** ----- Local-date helpers (no UTC) ----- */
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

export default function TrainingTodayPage(){
  // Supabase client
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [me, setMe] = useState<{ id: string; display_name: string | null; email: string | null } | null>(null);

  const [selectedDay, setSelectedDay] = useState<string>(ymd(new Date())); // ✅ true local today
  const [weekSessions, setWeekSessions] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(false);

  const weekStart = useMemo(
    () => startOfWeekISO_local(fromYMD(selectedDay)),
    [selectedDay]
  );
  const weekEnd = useMemo(() => addDaysISO(weekStart, 7), [weekStart]);

  const countsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of weekSessions) map[s.session_date] = (map[s.session_date] ?? 0) + 1;
    return map;
  }, [weekSessions]);

  const loadMeAndWeek = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) return;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }

      const meQ = supabase.from("profiles").select("id,display_name,email").eq("id", user.id).single();
      const wkQ = supabase
        .from("training_plan_items")
        .select("*")
        .eq("user_id", user.id)
        .gte("session_date", weekStart) // local ISO strings work fine with DATE columns
        .lt("session_date", weekEnd)
        .order("session_date", { ascending: true });

      const [meRes, wkRes] = await Promise.all([meQ, wkQ]);
      if (meRes.error) throw meRes.error;
      if (wkRes.error) throw wkRes.error;

      setMe(meRes.data);
      setWeekSessions((wkRes.data || []) as PlanItem[]);
    } catch (e:any) {
      setNote(e.message ?? String(e));
    } finally { setLoading(false); }
  }, [isConfigured, supabase, weekStart, weekEnd]);

  useEffect(() => { loadMeAndWeek(); }, [loadMeAndWeek]);

  const todays = useMemo(
    () => weekSessions.filter(s => s.session_date === selectedDay),
    [weekSessions, selectedDay]
  );

  return (
    <div className="max-w-5xl mx-auto pb-16">
      <NavBar />

      {/* Week scroller with week nav */}
      <div className="mt-6">
        <TodayStrip
          value={selectedDay}
          onChange={setSelectedDay}       // ← handles Sunday and future weeks correctly
          countsByDate={countsByDate}
        />
      </div>

      {/* Today */}
      <div className="mt-4 card p-4">
        <div className="flex items-center">
          <h2 className="text-xl font-semibold">Today</h2>
          <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>
            {new Date(fromYMD(selectedDay)).toLocaleDateString(undefined, {
              weekday: "long", month: "short", day: "numeric"
            })}
          </div>
        </div>
        {note && <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div>}

        {loading ? (
          <div className="mt-4">Loading…</div>
        ) : todays.length === 0 ? (
          <div className="mt-3" style={{ color: "var(--muted)" }}>No workouts scheduled.</div>
        ) : (
          <div className="mt-3 grid grid-2">
            {todays.map(s => (
              <Link key={s.id} href={`/training/session/${s.id}`} className="card p-4 hover:bg-white/5 transition">
                <div className="flex items-center gap-2">
                  <div className="text-sm px-2 py-1 rounded bg-white/10">
                    {s.sport.toUpperCase()}
                  </div>
                  <div className="font-semibold">{s.title || "Session"}</div>
                  <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
                    {s.duration_min ? `${s.duration_min} min` : "—"}
                  </div>
                </div>
                {s.details ? (
                  <p className="text-sm mt-2 opacity-80 line-clamp-2">{s.details}</p>
                ) : null}
                <div className="text-xs mt-2 opacity-70">
                  Status: {s.status === "completed" ? "✅ Completed" : s.status === "skipped" ? "⏭ Skipped" : "Planned"}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="mt-4 grid grid-3">
        <Link href="/forms/readiness" className="card p-4 hover:bg-white/5 transition">
          <div className="font-semibold">Readiness</div>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            60-second check-in before training.
          </p>
        </Link>
        <Link href="/training/history" className="card p-4 hover:bg-white/5 transition">
          <div className="font-semibold">History</div>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Past sessions, PBs, compliance.
          </p>
        </Link>
        <Link href="/training" className="card p-4 hover:bg-white/5 transition">
          <div className="font-semibold">Messages</div>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Chat with your coach (coming soon).
          </p>
        </Link>
      </div>
    </div>
  );
}
