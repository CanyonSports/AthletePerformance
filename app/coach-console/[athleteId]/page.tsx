// app/coach-console/[athleteId]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import WeekPicker from "@/components/WeekPicker";
import * as Supa from "@/lib/supabaseClient";

/* ---------- Types ---------- */
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

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "athlete" | "coach" | "admin" | null;
};

/* ---------- Helpers ---------- */
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
function startOfWeekISO(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Monday=0
  x.setDate(x.getDate() - day);
  return ymd(x);
}
function weekdayLabel(iso: string) {
  return fromYMD(iso).toLocaleDateString(undefined, { weekday: "long" });
}
function isUUID(v: string | undefined | null) {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function CoachAthleteConsolePage() {
  const params = useParams() as { athleteId?: string };
  // Decode & normalize the route param
  const athleteId = params?.athleteId ? decodeURIComponent(params.athleteId) : "";

  // Supabase: support either getSupabase() or exported supabase constant
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  // State
  const [me, setMe] = useState<Profile | null>(null);
  const [athlete, setAthlete] = useState<Profile | null>(null);
  const [authorized, setAuthorized] = useState<boolean>(false);

  const [weekStart, setWeekStart] = useState<string>(startOfWeekISO(new Date()));
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newDate, setNewDate] = useState<string>(weekStart);

  const [activeTab, setActiveTab] = useState<"sessions" | "builder">("sessions");
  const [drafts, setDrafts] = useState<Record<string, { title: string; details: string }>>({});

  // targeted errors
  const [headerError, setHeaderError] = useState("");
  const [addError, setAddError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [toolsError, setToolsError] = useState("");

  // throttle realtime after optimistic writes
  const lastMutationRef = useRef<number>(0);

  // move UI per-session
  const [moveOpen, setMoveOpen] = useState<Record<string, boolean>>({});
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});

  /* ---------- Load me + athlete + authorization ---------- */
  const loadWho = useCallback(async () => {
    setHeaderError("");
    if (!isConfigured || !supabase) return;

    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) { setHeaderError("Please sign in."); return; }

      // me (profile)
      const meRes = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (meRes.error) throw meRes.error;
      setMe(meRes.data as Profile);

      // athlete (profile)
      if (!isUUID(athleteId)) {
        setHeaderError("Invalid athlete id in URL.");
        setAthlete(null);
        setAuthorized(false);
        return;
      }
      const aRes = await supabase.from("profiles").select("*").eq("id", athleteId).single();
      if (aRes.error) throw aRes.error;
      setAthlete(aRes.data as Profile);

      // Check link
      const link = await supabase
        .from("coach_athletes")
        .select("coach_id, athlete_id")
        .eq("coach_id", meRes.data.id)
        .eq("athlete_id", athleteId)
        .maybeSingle();

      const ok = (meRes.data?.role === "admin") || Boolean(link.data);
      setAuthorized(ok);
      if (!ok) setHeaderError("You are not linked to this athlete. Click the button below to link.");
    } catch (e: any) {
      setHeaderError(e.message ?? String(e));
    }
  }, [isConfigured, supabase, athleteId]);

  useEffect(() => { loadWho(); }, [loadWho]);

  /* ---------- Load week plan ---------- */
  const loadWeek = useCallback(async () => {
    if (!isConfigured || !supabase || !isUUID(athleteId)) return;
    setLoading(true);
    setAddError(""); setSaveError(""); setDeleteError(""); setToolsError("");
    try {
      const end = addDaysISO(weekStart, 7);
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("user_id", athleteId)
        .gte("session_date", weekStart)
        .lt("session_date", end)
        .order("session_date", { ascending: true });

      if (error) throw error;
      setItems((data || []) as PlanItem[]);
      if (newDate < weekStart || newDate >= end) setNewDate(weekStart);
    } catch (e: any) {
      setHeaderError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, athleteId, weekStart, newDate]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  /* ---------- Realtime refresh ---------- */
  useEffect(() => {
    if (!isConfigured || !supabase || !isUUID(athleteId)) return;
    let mounted = true;
    const channel = supabase
      .channel(`coach-week-${athleteId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "training_plan_items", filter: `user_id=eq.${athleteId}` },
        () => {
          const now = Date.now();
          if (now - lastMutationRef.current < 400) return;
          if (mounted) loadWeek();
        }
      )
      .subscribe();
    return () => {
      mounted = false;
      try { supabase.removeChannel(channel); channel?.unsubscribe?.(); } catch {}
    };
  }, [isConfigured, supabase, athleteId, loadWeek]);

  /* ---------- Mutations (optimistic) ---------- */
  function sortByDate(list: PlanItem[]) {
    return [...list].sort((a, b) => a.session_date.localeCompare(b.session_date));
  }

  async function addSessionOn(dateISO: string, title: string, details: string) {
    setAddError("");
    if (!isConfigured || !supabase) { setAddError("Supabase not configured."); return; }
    if (!isUUID(athleteId)) { setAddError("Invalid athlete id in URL."); return; }
    if (!authorized) { setAddError("You’re not linked to this athlete yet."); return; }
    if (!dateISO) { setAddError("Pick a date first."); return; }

    const tempId = `temp-${Math.random().toString(36).slice(2)}`;
    const temp: PlanItem = {
      id: tempId,
      user_id: athleteId,
      session_date: dateISO,
      title: title || "New Session",
      details: details || "",
      duration_min: null,
      rpe: null,
      status: "planned",
    };

    // optimistic
    setItems(prev => sortByDate([...prev, temp]));
    lastMutationRef.current = Date.now();

    try {
      const { data, error } = await supabase
        .from("training_plan_items")
        .insert({
          user_id: athleteId,
          session_date: dateISO,
          title: temp.title,
          details: temp.details,
          duration_min: null,
          rpe: null,
          status: "planned",
        })
        .select("*")
        .single();
      if (error) throw error;

      // replace temp with real
      setItems(prev => sortByDate(prev.map(x => (x.id === tempId ? (data as PlanItem) : x))));
      setDrafts(d => ({ ...d, [dateISO]: { title: "", details: "" } }));
    } catch (e: any) {
      // revert
      setItems(prev => prev.filter(x => x.id !== tempId));
      setAddError(e.message ?? String(e));
    }
  }

  async function updateField(id: string, patch: Partial<PlanItem>) {
    setSaveError("");
    if (!isConfigured || !supabase) { setSaveError("Supabase not configured."); return; }

    const before = items;
    setItems(prev => {
      const next = prev.map(it => (it.id === id ? { ...it, ...patch } as PlanItem : it));
      return "session_date" in (patch as any) ? sortByDate(next) : next;
    });
    lastMutationRef.current = Date.now();

    const { error } = await supabase.from("training_plan_items").update(patch).eq("id", id);
    if (error) {
      setItems(before); // revert
      setSaveError(error.message ?? String(error));
    }
  }

  async function deleteSession(id: string) {
    setDeleteError("");
    if (!isConfigured || !supabase) { setDeleteError("Supabase not configured."); return; }

    const before = items;
    setItems(prev => prev.filter(it => it.id !== id));
    lastMutationRef.current = Date.now();

    const { error } = await supabase.from("training_plan_items").delete().eq("id", id);
    if (error) {
      setItems(before);
      setDeleteError(error.message ?? String(error));
    }
  }

  /* ---------- Session tools ---------- */

  // Duplicate a single session on the same date (optimistic)
  async function duplicateSession(src: PlanItem) {
    setToolsError("");
    if (!isConfigured || !supabase) { setToolsError("Supabase not configured."); return; }
    try {
      // optimistic add a temp
      const tempId = `dup-${Math.random().toString(36).slice(2)}`;
      const temp: PlanItem = {
        ...src,
        id: tempId,
        title: src.title ? `${src.title} (Copy)` : "Session (Copy)",
      };
      setItems(prev => sortByDate([...prev, temp]));
      lastMutationRef.current = Date.now();

      const { data, error } = await supabase
        .from("training_plan_items")
        .insert({
          user_id: src.user_id,
          session_date: src.session_date,
          title: temp.title,
          details: src.details,
          duration_min: src.duration_min,
          rpe: src.rpe,
          status: "planned", // copies as planned
        })
        .select("*")
        .single();
      if (error) throw error;

      setItems(prev => sortByDate(prev.map(it => it.id === tempId ? (data as PlanItem) : it)));
    } catch (e: any) {
      // reload to be safe if optimistic add failed
      setToolsError(e.message ?? String(e));
      await loadWeek();
    }
  }

  // Toggle the inline move UI
  function openMove(it: PlanItem) {
    setMoveOpen(prev => ({ ...prev, [it.id]: !prev[it.id] }));
    setMoveTarget(prev => ({ ...prev, [it.id]: prev[it.id] || it.session_date }));
  }

  // Move a session to a new date (optimistic)
  async function moveSession(it: PlanItem) {
    setToolsError("");
    if (!isConfigured || !supabase) { setToolsError("Supabase not configured."); return; }
    const target = moveTarget[it.id];
    if (!target) { setToolsError("Pick a date to move to."); return; }

    const before = items;
    setItems(prev => sortByDate(prev.map(x => x.id === it.id ? { ...x, session_date: target } : x)));
    lastMutationRef.current = Date.now();

    const { error } = await supabase
      .from("training_plan_items")
      .update({ session_date: target })
      .eq("id", it.id);

    if (error) {
      setItems(before);
      setToolsError(error.message ?? String(error));
    } else {
      setMoveOpen(prev => ({ ...prev, [it.id]: false }));
    }
  }

  // Copy all sessions in current week to the next week (optimistic batch)
  async function copyWeekToNext() {
    setToolsError("");
    if (!isConfigured || !supabase) { setToolsError("Supabase not configured."); return; }
    if (!authorized) { setToolsError("Link to this athlete first."); return; }

    const weekEnd = addDaysISO(weekStart, 7);
    const inWeek = items.filter(it => it.session_date >= weekStart && it.session_date < weekEnd);
    if (inWeek.length === 0) { setToolsError("No sessions in this week to copy."); return; }

    try {
      // optimistic: add temps
      const temps: PlanItem[] = inWeek.map(src => ({
        ...src,
        id: `wkcopy-${Math.random().toString(36).slice(2)}`,
        session_date: addDaysISO(src.session_date, 7),
        title: src.title ? `${src.title} (wk+1)` : "Session (wk+1)",
        status: "planned",
      }));
      setItems(prev => sortByDate([...prev, ...temps]));
      lastMutationRef.current = Date.now();

      // insert real rows
      const payload = inWeek.map(src => ({
        user_id: src.user_id,
        session_date: addDaysISO(src.session_date, 7),
        title: src.title ? `${src.title} (wk+1)` : "Session (wk+1)",
        details: src.details,
        duration_min: src.duration_min,
        rpe: src.rpe,
        status: "planned",
      }));
      const { data, error } = await supabase
        .from("training_plan_items")
        .insert(payload)
        .select("*");
      if (error) throw error;

      // Replace temps with real
      // Match by (session_date, title) heuristic
      const real = (data || []) as PlanItem[];
      setItems(prev => {
        let next = prev.filter(p => !p.id.startsWith("wkcopy-"));
        next = sortByDate([...next, ...real]);
        return next;
      });
    } catch (e: any) {
      setToolsError(e.message ?? String(e));
      await loadWeek();
    }
  }

  /* ---------- Link button (idempotent) ---------- */
  async function linkMeToAthlete() {
    try {
      if (!supabase) throw new Error("Supabase not configured");
      if (!isUUID(athleteId)) throw new Error("Invalid athlete id in URL.");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required");

      const { error } = await supabase
        .from("coach_athletes")
        .upsert({ coach_id: user.id, athlete_id: athleteId }, { onConflict: "coach_id,athlete_id" });
      if (error && error.code !== "23505") throw error;

      const check = await supabase
        .from("coach_athletes")
        .select("coach_id, athlete_id")
        .eq("coach_id", user.id)
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (check.error) throw check.error;

      const ok = Boolean(check.data);
      setAuthorized(ok);
      setHeaderError(ok ? "" : "Linked, but cannot read coach_athletes (RLS).");
      await loadWeek();
    } catch (e: any) {
      setHeaderError(e.message ?? String(e));
    }
  }

  /* ---------- Derived ---------- */
  const headerName = athlete?.display_name || athlete?.email || "(Athlete)";
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const sessionsByDay = (iso: string) => items.filter(it => it.session_date === iso);

  /* ---------- UI ---------- */
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <NavBar />

      {/* Sticky header */}
      <div className="card p-4" style={{ position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(6px)", background: "rgba(0,0,0,0.6)" }}>
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <Link href="/coach" className="btn">← Back</Link>
          <div className="avatar">{(headerName || "?").slice(0, 1).toUpperCase()}</div>
          <div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>Coach Console</div>
            <h1 className="text-xl font-semibold">{headerName}</h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <WeekPicker value={weekStart} onChange={(v) => setWeekStart(v)} />
          </div>
        </div>

        {/* Debug chips */}
        <div className="mt-2 text-xs" style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--muted)" }}>
          <span>User: {me?.id?.slice(0, 8) || "?"}</span>
          <span>Role: {me?.role || "?"}</span>
          <span>Athlete: {isUUID(athleteId) ? athleteId.slice(0, 8) : "invalid"}</span>
          <span>Authorized: {authorized ? "yes" : "no"}</span>
        </div>

        {headerError ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{headerError}</div> : null}

        {!authorized && isUUID(athleteId) && (
          <div className="mt-2">
            <button className="btn btn-dark" onClick={linkMeToAthlete}>Link me to this athlete</button>
            <span className="text-xs ml-3" style={{ color: "var(--muted)" }}>
              Creates a coach_athletes link so you can manage this athlete.
            </span>
          </div>
        )}
      </div>

      {/* Two columns: Left = Add + Week Tools, Right = Tabs */}
      <div className="mt-4 grid" style={{ gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 16 }}>
        {/* LEFT */}
        <aside className="flex flex-col gap-3">
          <div className="card p-4">
            <h3 className="font-semibold">Add Session</h3>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Pick a date and create a new session.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="date"
                className="px-3 py-2 rounded bg-white/5 border border-white/10"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value || weekStart)}
              />
              <button
                className="btn btn-dark"
                onClick={() => addSessionOn(newDate, "New Session", "")}
                disabled={!authorized || !isUUID(athleteId)}
                title={!authorized ? "Link to athlete first" : (!isUUID(athleteId) ? "Invalid athlete id" : "")}
              >
                + Add Session
              </button>
            </div>
            {addError ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{addError}</div> : null}
          </div>

          {/* Week tools */}
          <div className="card p-4">
            <h3 className="font-semibold">Week Tools</h3>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Bulk operations for the visible week.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-dark" onClick={copyWeekToNext} disabled={!authorized}>
                Copy this week → next week
              </button>
            </div>
            {toolsError ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{toolsError}</div> : null}
          </div>
        </aside>

        {/* RIGHT */}
        <main className="flex flex-col gap-3">
          {/* Tabs */}
          <div className="card p-3">
            <div className="tabs">
              <button
                className={`tab ${activeTab === "sessions" ? "tab-active" : ""}`}
                onClick={() => setActiveTab("sessions")}
              >
                Week Sessions
              </button>
              <button
                className={`tab ${activeTab === "builder" ? "tab-active" : ""}`}
                onClick={() => setActiveTab("builder")}
              >
                Builder
              </button>
            </div>
          </div>

          {/* READ-ONLY list (with tools) */}
          {activeTab === "sessions" ? (
            <div className="card p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Week Sessions</h2>
                {loading ? <span className="text-xs" style={{ color: "var(--muted)" }}>Loading…</span> : null}
                <span className="ml-auto text-sm" style={{ color: "var(--muted)" }}>
                  Week of {new Date(fromYMD(weekStart)).toLocaleDateString()}
                </span>
              </div>

              <div className="mt-3 space-y-4">
                {weekDays.map(day => {
                  const list = sessionsByDay(day);
                  return (
                    <div key={day}>
                      <div className="text-sm font-semibold">
                        {weekdayLabel(day)} • {new Date(fromYMD(day)).toLocaleDateString()}
                      </div>

                      {list.length === 0 ? (
                        <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>No sessions.</div>
                      ) : (
                        <div className="mt-2 grid" style={{ gap: 8 }}>
                          {list.map(it => (
                            <div key={it.id} className="card p-3">
                              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                                <div className="font-semibold">{it.title || "(Untitled session)"}</div>
                                <div className="ml-auto flex gap-2" style={{ flexWrap: "wrap" }}>
                                  <Link className="btn" href={`/coach-console/${athleteId}/session/${it.id}`}>Edit</Link>
                                  <button className="btn" onClick={() => duplicateSession(it)}>Duplicate</button>
                                  <button className="btn" onClick={() => openMove(it)}>{moveOpen[it.id] ? "Cancel Move" : "Move"}</button>
                                  <button className="btn btn-dark" onClick={() => deleteSession(it.id)}>Delete</button>
                                </div>
                              </div>

                              {/* Move inline controls */}
                              {moveOpen[it.id] ? (
                                <div className="mt-2 flex items-center gap-2">
                                  <input
                                    type="date"
                                    className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                    value={moveTarget[it.id] || it.session_date}
                                    onChange={(e) => setMoveTarget(prev => ({ ...prev, [it.id]: e.target.value }))}
                                  />
                                  <button className="btn btn-dark" onClick={() => moveSession(it)}>
                                    Move to date
                                  </button>
                                </div>
                              ) : null}

                              <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>
                                {it.details || "(No description)"}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {deleteError ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{deleteError}</div> : null}
              {toolsError ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{toolsError}</div> : null}
            </div>
          ) : (
            // EDITABLE overview (no embedded ProgramBuilder)
            <div className="card p-4">
              <h3 className="font-semibold">Builder</h3>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Edit existing sessions or add new ones. Changes save instantly.
              </p>

              <div className="mt-3 space-y-6">
                {weekDays.map(day => {
                  const list = sessionsByDay(day);
                  const draft = drafts[day] || { title: "", details: "" };
                  return (
                    <div key={day}>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold">
                          {weekdayLabel(day)} • {new Date(fromYMD(day)).toLocaleDateString()}
                        </div>
                        <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>{day}</div>
                      </div>

                      {/* Quick add */}
                      <div className="mt-2 card p-3">
                        <div className="grid" style={{ gap: 8 }}>
                          <input
                            className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                            placeholder="New session title"
                            value={draft.title}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [day]: { ...draft, title: e.target.value } }))
                            }
                          />
                          <textarea
                            className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                            placeholder="Description / intent (optional)"
                            rows={2}
                            value={draft.details}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [day]: { ...draft, details: e.target.value } }))
                            }
                          />
                          <div className="flex gap-2">
                            <button
                              className="btn btn-dark"
                              onClick={() => addSessionOn(day, draft.title.trim(), draft.details.trim())}
                              disabled={draft.title.trim().length === 0 || !authorized || !isUUID(athleteId)}
                              title={
                                !authorized ? "Link to athlete first"
                                : (!isUUID(athleteId) ? "Invalid athlete id" : "")
                              }
                            >
                              + Add to {weekdayLabel(day)}
                            </button>
                            {(draft.title || draft.details) ? (
                              <button
                                className="btn"
                                onClick={() => setDrafts((d) => ({ ...d, [day]: { title: "", details: "" } }))}
                              >
                                Clear
                              </button>
                            ) : null}
                          </div>
                          {addError ? <div className="text-xs" style={{ color: "#fca5a5" }}>{addError}</div> : null}
                        </div>
                      </div>

                      {/* Existing sessions (editable summary + tools) */}
                      {list.length === 0 ? (
                        <div className="text-sm mt-2" style={{ color: "var(--muted)" }}>No sessions yet.</div>
                      ) : (
                        <div className="mt-2 grid" style={{ gap: 8 }}>
                          {list.map(it => (
                            <div key={it.id} className="card p-3">
                              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                                <input
                                  type="date"
                                  className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                  value={it.session_date}
                                  onChange={(e) => updateField(it.id, { session_date: e.target.value })}
                                />
                                <div className="ml-auto flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                                  <Link className="btn" href={`/coach-console/${athleteId}/session/${it.id}`}>Edit</Link>
                                  <button className="btn" onClick={() => duplicateSession(it)}>Duplicate</button>
                                  <button className="btn" onClick={() => openMove(it)}>{moveOpen[it.id] ? "Cancel Move" : "Move"}</button>
                                  <button className="btn btn-dark" onClick={() => deleteSession(it.id)}>Delete</button>
                                </div>
                              </div>

                              {/* Move inline controls */}
                              {moveOpen[it.id] ? (
                                <div className="mt-2 flex items-center gap-2">
                                  <input
                                    type="date"
                                    className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                    value={moveTarget[it.id] || it.session_date}
                                    onChange={(e) => setMoveTarget(prev => ({ ...prev, [it.id]: e.target.value }))}
                                  />
                                  <button className="btn btn-dark" onClick={() => moveSession(it)}>
                                    Move to date
                                  </button>
                                </div>
                              ) : null}

                              <input
                                className="w-full mt-3 px-3 py-2 rounded bg-white/5 border border-white/10"
                                placeholder="Title"
                                value={it.title || ""}
                                onChange={(e) => updateField(it.id, { title: e.target.value })}
                              />
                              <textarea
                                className="w-full mt-2 px-3 py-2 rounded bg-white/5 border border-white/10"
                                placeholder="Details / intent"
                                rows={3}
                                value={it.details ?? ""}
                                onChange={(e) => updateField(it.id, { details: e.target.value })}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {saveError ? <div className="text-xs mt-3" style={{ color: "#fca5a5" }}>{saveError}</div> : null}
              {toolsError ? <div className="text-xs mt-3" style={{ color: "#fca5a5" }}>{toolsError}</div> : null}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
