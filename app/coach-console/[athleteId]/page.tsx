// app/coach-console/[athleteId]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import WeekPicker from "@/components/WeekPicker";
import TemplatesPanel from "@/components/TemplatesPanel";
import EnduranceEditor from "@/components/EnduranceEditor";
import * as Supa from "@/lib/supabaseClient";

type Sport = "climbing" | "ski" | "mtb" | "running";

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "athlete" | "coach" | "admin" | null;
};

type PlanItem = {
  id: string;
  user_id: string;
  sport: Sport;
  session_date: string; // yyyy-mm-dd (local)
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

/* ---------- Local date helpers (avoid UTC drift) ---------- */
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
function weekdayLabel(iso: string) {
  return fromYMD(iso).toLocaleDateString(undefined, { weekday: "long" });
}

export default function CoachAthleteConsolePage() {
  const { athleteId } = useParams<{ athleteId: string }>();

  // Supabase (supports either getSupabase() or supabase export)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [me, setMe] = useState<Profile | null>(null);
  const [athlete, setAthlete] = useState<Profile | null>(null);
  const [authorized, setAuthorized] = useState<boolean>(false);

  const [sport, setSport] = useState<Sport>("climbing");
  const [weekStart, setWeekStart] = useState<string>(startOfWeekISO_local(new Date()));
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newDate, setNewDate] = useState<string>(weekStart);

  // NEW: tab to switch read-only sessions vs editable builder
  const [activeTab, setActiveTab] = useState<"sessions" | "builder">("sessions");

  // NEW: per-day drafts for quick add { [iso]: { title, details } }
  const [drafts, setDrafts] = useState<Record<string, { title: string; details: string }>>({});

  /* ---------- Load coach + athlete + authorization ---------- */
  const loadWho = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setNote("Please sign in."); return; }

      const meRes = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (meRes.error) throw meRes.error;
      setMe(meRes.data as Profile);

      const aRes = await supabase.from("profiles").select("*").eq("id", athleteId).single();
      if (aRes.error) throw aRes.error;
      setAthlete(aRes.data as Profile);

      let ok = (meRes.data?.role === "coach" || meRes.data?.role === "admin");
      if (ok && meRes.data?.role === "coach") {
        const linkRes = await supabase
          .from("coach_athletes")
          .select("id")
          .eq("coach_id", user.id)
          .eq("athlete_id", athleteId)
          .maybeSingle();
        ok = Boolean(linkRes.data);
      }
      setAuthorized(ok);
      if (!ok) setNote("You are not linked to this athlete.");
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase, athleteId]);

  useEffect(() => { loadWho(); }, [loadWho]);

  /* ---------- Load week sessions ---------- */
  const loadWeek = useCallback(async () => {
    if (!isConfigured || !supabase || !athleteId) return;
    setLoading(true);
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
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, athleteId, weekStart, newDate]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  /* ---------- Realtime refresh ---------- */
  useEffect(() => {
    if (!isConfigured || !supabase || !athleteId) return;
    let mounted = true;
    const channel = supabase
      .channel(`coach-week-${athleteId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "training_plan_items", filter: `user_id=eq.${athleteId}` },
        () => { if (mounted) loadWeek(); }
      )
      .subscribe();
    return () => {
      mounted = false;
      try { supabase.removeChannel(channel); channel?.unsubscribe?.(); } catch {}
    };
  }, [isConfigured, supabase, athleteId, loadWeek]);

  /* ---------- Mutations ---------- */
  async function linkMeToAthlete() {
    if (!isConfigured || !supabase || !athleteId) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required");
      const { error } = await supabase
        .from("coach_athletes")
        .insert({ coach_id: user.id, athlete_id: athleteId });
      if (error) throw error;
      setAuthorized(true);
      setNote("Linked! You now manage this athlete.");
    } catch (e:any) {
      setNote(e.message ?? String(e));
    }
  }

  async function addSessionOn(dateISO: string, title: string, details: string) {
    if (!isConfigured || !supabase || !athleteId) return;
    const row: Omit<PlanItem, "id"> = {
      user_id: athleteId,
      sport,
      session_date: dateISO,
      title: title || "New Session",
      details: details || "",
      duration_min: null,
      rpe: null,
      status: "planned",
    };
    const { error } = await supabase.from("training_plan_items").insert(row as any);
    if (error) setNote(error.message);
    else await loadWeek();
  }

  async function updateField(id: string, patch: Partial<PlanItem>) {
    if (!isConfigured || !supabase) return;
    const { error } = await supabase.from("training_plan_items").update(patch).eq("id", id);
    if (error) setNote(error.message);
  }
  async function deleteSession(id: string) {
    if (!isConfigured || !supabase) return;
    const { error } = await supabase.from("training_plan_items").delete().eq("id", id);
    if (error) setNote(error.message);
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
        <div className="flex items-center gap-3" style={{flexWrap:"wrap"}}>
          <Link href="/coach" className="btn">← Back</Link>
          <div className="avatar">{(headerName || "?").slice(0,1).toUpperCase()}</div>
          <div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>Coach Console</div>
            <h1 className="text-xl font-semibold">{headerName}</h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <WeekPicker value={weekStart} onChange={(v) => setWeekStart(v)} />
            <select
              className="px-3 py-2 rounded bg-white/5 border border-white/10"
              value={sport}
              onChange={(e) => setSport(e.target.value as Sport)}
              title="Sport context for new sessions"
            >
              <option value="climbing">Climbing</option>
              <option value="ski">Ski</option>
              <option value="mtb">MTB</option>
              <option value="running">Running</option>
            </select>
          </div>
        </div>

        {note ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div> : null}
        {me && (me.role === "coach" || me.role === "admin") && !authorized ? (
          <div className="mt-2">
            <button className="btn btn-dark" onClick={linkMeToAthlete}>Link me to this athlete</button>
            <span className="text-xs ml-3" style={{ color: "var(--muted)" }}>
              Creates a coach_athletes link so you can manage this athlete.
            </span>
          </div>
        ) : null}
      </div>

      {/* Two columns: Left = Templates; Right = Sessions OR Builder */}
      <div className="mt-4 grid" style={{ gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 16 }}>
        {/* LEFT: Templates & quick add (unchanged) */}
        <aside className="flex flex-col gap-3">
          <div className="card p-4">
            <h3 className="font-semibold">Add Session</h3>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Choose a date and create a new session (uses selected sport).
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="date"
                className="px-3 py-2 rounded bg-white/5 border border-white/10"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value || weekStart)}
              />
              <button className="btn btn-dark" onClick={() => addSessionOn(newDate, "New Session", "")} disabled={!authorized}>
                + Add Session
              </button>
            </div>
          </div>

          <TemplatesPanel
            athleteId={athleteId}
            sport={sport}
            weekStart={weekStart}
            onApplied={() => loadWeek()}
          />
        </aside>

        {/* RIGHT: Tabs */}
        <main className="flex flex-col gap-3">
          {/* Tab switcher */}
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

          {/* Tab: READ-ONLY Week Sessions */}
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
                              <div className="flex items-center gap-2">
                                <div className="font-semibold">{it.title || "(Untitled session)"}</div>
                                <div className="ml-auto flex gap-2">
                                  <Link className="btn" href={`/coach-console/${athleteId}/session/${it.id}`}>Edit</Link>
                                  <button className="btn btn-dark" onClick={() => deleteSession(it.id)}>Delete</button>
                                </div>
                              </div>
                              {it.details ? (
                                <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>
                                  {it.details}
                                </div>
                              ) : (
                                <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>
                                  (No description)
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            // Tab: EDITABLE BUILDER VIEW (now WITH per-day quick-add)
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

                      {/* Per-day quick add (title + description) */}
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
                              onClick={() => {
                                addSessionOn(day, draft.title.trim(), draft.details.trim());
                                setDrafts((d) => ({ ...d, [day]: { title: "", details: "" } }));
                              }}
                              disabled={!authorized || draft.title.trim().length === 0}
                            >
                              + Add to {weekdayLabel(day)}
                            </button>
                            {/* Optional: clear */}
                            {(draft.title || draft.details) ? (
                              <button
                                className="btn"
                                onClick={() => setDrafts((d) => ({ ...d, [day]: { title: "", details: "" } }))}
                              >
                                Clear
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* Existing sessions (editable + Edit link) */}
                      {list.length === 0 ? (
                        <div className="text-sm mt-2" style={{ color: "var(--muted)" }}>No sessions yet.</div>
                      ) : (
                        <div className="mt-2 grid" style={{ gap: 8 }}>
                          {list.map(it => (
                            <div key={it.id} className="card p-3">
                              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                                {/* Move between days */}
                                <input
                                  type="date"
                                  className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                  value={it.session_date}
                                  onChange={(e) => updateField(it.id, { session_date: e.target.value })}
                                />
                                <div className="ml-auto flex items-center gap-2">
                                  <Link className="btn" href={`/coach-console/${athleteId}/session/${it.id}`}>Edit</Link>
                                  <button className="btn btn-dark" onClick={() => deleteSession(it.id)}>Delete</button>
                                </div>
                              </div>

                              {/* Editable title & description */}
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

                              {/* Endurance intervals editor for endurance sports */}
                              {(it.sport === "running" || it.sport === "mtb" || it.sport === "ski") ? (
                                <div className="mt-3">
                                  <EnduranceEditor planItemId={it.id} athleteId={it.user_id} />
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
          )}
        </main>
      </div>
    </div>
  );
}
