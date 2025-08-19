// app/training/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { getSupabase } from "@/lib/supabaseClient";
import { CalendarDays, CheckCircle2, MessageSquare, XCircle, Trash2, ChevronLeft, ChevronRight } from "lucide-react";

/* ----------------------------- Types ----------------------------- */

type Role = "athlete" | "coach" | "admin";

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: Role | null;
};

type PlanItem = {
  id: string;
  user_id: string;
  session_date: string; // yyyy-mm-dd
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

type LinkRow = { coach_id: string; athlete_id: string };

/* ----------------------------- Pure YYYY-MM-DD utils ----------------------------- */

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromYMD(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  // noon local avoids DST shenanigans
  return new Date((y as number) || 1970, ((m as number) || 1) - 1, (d as number) || 1, 12, 0, 0, 0);
}
function addDaysISO(iso: string, days: number) {
  const dt = fromYMD(iso);
  dt.setDate(dt.getDate() + days);
  return ymd(dt);
}
function startOfWeekISO(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Monday=0
  x.setDate(x.getDate() - day);
  return ymd(x);
}

/* ----------------------------- Page ----------------------------- */

export default function AthleteTrainingPage() {
  const router = useRouter();

  const supabase = useMemo(() => {
    try { return getSupabase(); } catch { return null; }
  }, []);
  const isConfigured = Boolean(supabase);

  const [me, setMe] = useState<Profile | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");

  const [weekStart, setWeekStart] = useState<string>(startOfWeekISO(new Date()));
  const weekEnd = addDaysISO(weekStart, 7);

  const [coachId, setCoachId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [msgStatus, setMsgStatus] = useState("");

  const chRef = useRef<any>(null);

  /* ----------------------------- Loaders ----------------------------- */

  const loadMe = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const prof = await supabase.from("profiles").select("id,email,display_name,role").eq("id", user.id).single();
      if (prof.error) throw prof.error;
      setMe(prof.data as Profile);
    } catch (e: any) {
      setNote(e?.message || String(e));
    }
  }, [isConfigured, supabase, router]);

  const loadWeek = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    setLoading(true);
    setNote("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setItems([]); return; }
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("id,user_id,session_date,title,details,duration_min,rpe,status,created_at")
        .eq("user_id", user.id)
        .gte("session_date", weekStart)
        .lt("session_date", weekEnd)
        .order("session_date", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      setItems((data || []) as PlanItem[]);
    } catch (e: any) {
      setNote(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, weekStart, weekEnd]);

  const loadCoach = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setCoachId(null); return; }
      const links = await supabase
        .from("coach_athletes")
        .select("coach_id, athlete_id")
        .eq("athlete_id", user.id);
      if (links.error) throw links.error;
      const first = (links.data as LinkRow[])?.[0];
      setCoachId(first?.coach_id || null);
    } catch {
      // ignore; optional
    }
  }, [isConfigured, supabase]);

  useEffect(() => {
    if (!isConfigured || !supabase) return;
    let mounted = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const ch = supabase
          .channel(`ath-training-${user.id}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "training_plan_items", filter: `user_id=eq.${user.id}` },
            () => { if (mounted) loadWeek(); }
          )
          .subscribe();
        chRef.current = ch;
      } catch (e) {
        // silent
      }
    })();
    return () => {
      mounted = false;
      const ch = chRef.current;
      try { if (supabase && ch) supabase.removeChannel(ch); ch?.unsubscribe?.(); } catch {}
    };
  }, [isConfigured, supabase, loadWeek]);

  useEffect(() => { loadMe(); loadWeek(); loadCoach(); }, [loadMe, loadWeek, loadCoach]);

  /* ----------------------------- Actions ----------------------------- */

  async function quickUpdateStatus(id: string, status: PlanItem["status"]) {
    if (!isConfigured || !supabase) return;
    const before = items;
    // optimistic
    setItems(prev => prev.map(x => x.id === id ? ({ ...x, status }) : x));
    const { error } = await supabase.from("training_plan_items").update({ status }).eq("id", id);
    if (error) {
      // rollback
      setItems(before);
      setNote(error.message);
    }
  }

  const deleteItem = useCallback(async (id: string) => {
    if (!isConfigured || !supabase) return;
    if (!confirm("Delete this workout?")) return;
    // optimistic remove
    setItems(prev => prev.filter(x => x.id !== id));
    const { error } = await supabase.from("training_plan_items").delete().eq("id", id);
    if (error) {
      setNote(error.message);
      // ensure UI consistent
      loadWeek();
    }
  }, [isConfigured, supabase, loadWeek]);

  async function sendMessage() {
    if (!isConfigured || !supabase) return;
    setMsgStatus("");
    try {
      const body = msg.trim();
      if (!body) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setMsgStatus("Sign in required."); return; }
      if (!coachId) { setMsgStatus("No coach linked yet."); return; }
      const { error } = await supabase.from("messages").insert({
        athlete_id: user.id,
        coach_id: coachId,
        sender_id: user.id,
        body,
      });
      if (error) throw error;
      setMsg("");
      setMsgStatus("Sent!");
      setTimeout(() => setMsgStatus(""), 1000);
    } catch (e: any) {
      setMsgStatus(e?.message || String(e));
    }
  }

  /* ----------------------------- Derived ----------------------------- */

  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const sessionsByDay = (iso: string) => items.filter(it => it.session_date === iso);

  /* ----------------------------- Render ----------------------------- */

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <NavBar />

      {/* Header / Week Picker */}
      <div className="mt-6 card p-4">
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <div className="rounded-full p-2 bg-white/10">
            <CalendarDays className="w-5 h-5 text-emerald-300" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Your Training</h1>
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Week of {new Date(fromYMD(weekStart)).toLocaleDateString()}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-dark" onClick={() => setWeekStart(addDaysISO(weekStart, -7))} aria-label="Previous week">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              className="px-3 py-2 rounded bg-white/5 border border-white/10"
              value={weekStart}
              onChange={e => {
                const v = e.target.value;
                if (v) {
                  // normalize to Monday
                  setWeekStart(startOfWeekISO(fromYMD(v)));
                }
              }}
              aria-label="Select week start"
            />
            <button className="btn btn-dark" onClick={() => setWeekStart(addDaysISO(weekStart, 7))} aria-label="Next week">
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Calendar + Program Builder */}
            <Link href="/training/calendar" className="btn" aria-label="Open month calendar">
              Calendar
            </Link>
            <Link href="/training/programs" className="btn" aria-label="Open program builder">
              Build Program
            </Link>
          </div>
        </div>
        {note ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div> : null}
      </div>

      {/* Message your coach */}
      <div className="mt-4 card p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Message your coach</h3>
          {coachId ? null : <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>(link a coach to enable)</span>}
          <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>{msgStatus}</span>
        </div>
        <div className="mt-2 flex gap-2" style={{ flexWrap: "wrap" }}>
          <textarea
            className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10"
            placeholder="Ask a question or share an update…"
            rows={2}
            value={msg}
            onChange={e => setMsg(e.target.value)}
            disabled={!coachId}
          />
          <button className="btn btn-dark" onClick={sendMessage} disabled={!coachId || msg.trim().length === 0}>
            <MessageSquare className="w-4 h-4 mr-1" /> Send
          </button>
        </div>
      </div>

      {/* Week list */}
      <div className="mt-4 card p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">This week</h3>
          {loading ? <span className="text-xs" style={{ color: "var(--muted)" }}>Loading…</span> : null}
        </div>

        <div className="mt-3 space-y-5">
          {days.map(day => {
            const list = sessionsByDay(day);
            return (
              <div key={day}>
                <div className="text-sm font-semibold">
                  {fromYMD(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                </div>

                {list.length === 0 ? (
                  <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>No session planned.</div>
                ) : (
                  <div className="mt-2 grid" style={{ gap: 8 }}>
                    {list.map(it => (
                      <div key={it.id} className="card p-3">
                        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                          <div className="font-semibold">{it.title || "(Untitled session)"}</div>
                          <div className="ml-auto flex items-center gap-2">
                            <Link className="btn" href={`/training/session/${it.id}`}>Open</Link>

                            {it.status !== "completed" ? (
                              <button className="btn btn-dark" onClick={() => quickUpdateStatus(it.id, "completed")}>
                                <CheckCircle2 className="w-4 h-4 mr-1" /> Completed
                              </button>
                            ) : (
                              <button className="btn" onClick={() => quickUpdateStatus(it.id, "planned")}>
                                Undo
                              </button>
                            )}

                            {it.status !== "skipped" ? (
                              <button className="btn btn-dark" onClick={() => quickUpdateStatus(it.id, "skipped")}>
                                <XCircle className="w-4 h-4 mr-1" /> Skipped
                              </button>
                            ) : (
                              <button className="btn" onClick={() => quickUpdateStatus(it.id, "planned")}>
                                Undo
                              </button>
                            )}

                            <button className="btn btn-dark" onClick={() => deleteItem(it.id)} title="Delete workout">
                              <Trash2 className="w-4 h-4 mr-1" /> Delete
                            </button>
                          </div>
                        </div>

                        <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                          Status: {it.status}
                          {it.duration_min ? ` • ${it.duration_min} min` : ""}
                          {typeof it.rpe === "number" ? ` • RPE ${it.rpe}` : ""}
                        </div>

                        {it.details ? (
                          <div className="text-sm mt-2 opacity-90 whitespace-pre-wrap">
                            {typeof it.details === "string" ? it.details : JSON.stringify(it.details, null, 2)}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
