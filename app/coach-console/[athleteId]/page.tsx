// app/coach-console/[athleteId]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import WeekPicker from "@/components/WeekPicker";
import * as Supa from "@/lib/supabaseClient";
import AthleteThread from "@/components/AthleteThread";
import {
  Mail, Phone, CalendarDays, User as UserIcon,
  Activity, HeartPulse, TrendingUp, TrendingDown, Minus
} from "lucide-react";

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

// Extendable profile (extra fields are optional & safe)
type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "athlete" | "coach" | "admin" | null;

  // Optional demographics/contact your app may add
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  dob?: string | null;              // yyyy-mm-dd
  gender?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  location?: string | null;
};

type MeasurementRow = {
  id: string;
  user_id: string;
  sport: string | null;
  test_date: string; // yyyy-mm-dd
  data: Record<string, any> | null; // e.g., { resting_hr: 48, max_hr: 193, hrv: 82, vo2max: 52 }
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
function formatPhone(s?: string | null) {
  if (!s) return "—";
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  return s;
}
function ageFromDOB(dob?: string | null) {
  if (!dob) return "—";
  const d = fromYMD(dob);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return `${age}`;
}
function cmToFtIn(cm?: number | null) {
  if (!cm || cm <= 0) return "—";
  const inches = Math.round(cm / 2.54);
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}′${inch}″`;
}
function kgToLb(kg?: number | null) {
  if (!kg || kg <= 0) return "—";
  return `${Math.round(kg * 2.20462)}`;
}

type Trend = "up" | "down" | "flat" | null;
function trendFrom(prev?: number | null, curr?: number | null): Trend {
  if (curr == null || prev == null) return null;
  if (curr > prev) return "up";
  if (curr < prev) return "down";
  return "flat";
}

/* ---------- Page ---------- */
export default function CoachAthleteConsolePage() {
  const params = useParams() as { athleteId?: string };
  const searchParams = useSearchParams();
  const focusMessageId = searchParams.get("focusMessageId") || undefined;

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

  // Tabs (incl. Messages)
  const [activeTab, setActiveTab] = useState<"sessions" | "builder" | "messages">("sessions");
  const [drafts, setDrafts] = useState<Record<string, { title: string; details: string }>>({});

  // targeted errors
  const [headerError, setHeaderError] = useState("");
  const [addError, setAddError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  // Athlete summary state
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [latestRows, setLatestRows] = useState<MeasurementRow[]>([]);

  // throttle realtime after optimistic writes
  const lastMutationRef = useRef<number>(0);

  /* ---------- Auto-open Messages tab if focusMessageId is present ---------- */
  useEffect(() => {
    if (focusMessageId) setActiveTab("messages");
  }, [focusMessageId]);

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
    setAddError(""); setSaveError(""); setDeleteError("");
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

  /* ---------- Athlete metrics (summary) ---------- */
  const loadMetrics = useCallback(async () => {
    if (!isConfigured || !supabase || !isUUID(athleteId)) return;
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const { data, error } = await supabase
        .from("measurements")
        .select("id,user_id,sport,test_date,data")
        .eq("user_id", athleteId)
        .order("test_date", { ascending: true })
        .limit(100); // enough history to find prev values
      if (error) throw error;
      setLatestRows((data || []) as MeasurementRow[]);
    } catch (e: any) {
      setMetricsError(e.message ?? String(e));
    } finally {
      setMetricsLoading(false);
    }
  }, [isConfigured, supabase, athleteId]);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "measurements", filter: `user_id=eq.${athleteId}` },
        () => { if (mounted) loadMetrics(); }
      )
      .subscribe();
    return () => {
      mounted = false;
      try { supabase.removeChannel(channel); channel?.unsubscribe?.(); } catch {}
    };
  }, [isConfigured, supabase, athleteId, loadWeek, loadMetrics]);

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

  /* ---------- Derived (summary helpers) ---------- */
  const headerName = athlete?.display_name || [athlete?.first_name, athlete?.last_name].filter(Boolean).join(" ") || athlete?.email || "(Athlete)";

  // pull last + prev metric for a given key across measurement rows (ascending order list)
  function lastTwoFor(key: string): { curr: number | null; prev: number | null } {
    if (!latestRows.length) return { curr: null, prev: null };
    let curr: number | null = null;
    let prev: number | null = null;
    for (let i = latestRows.length - 1; i >= 0; i--) {
      const v = latestRows[i]?.data?.[key];
      if (v == null || Number.isNaN(Number(v))) continue;
      if (curr == null) curr = Number(v);
      else { prev = Number(v); break; }
    }
    return { curr, prev };
  }

  const rhr = lastTwoFor("resting_hr");
  const maxhr = lastTwoFor("max_hr");
  const hrv = lastTwoFor("hrv");
  const vo2 = lastTwoFor("vo2max");

  const heightStr = athlete?.height_cm ? `${athlete.height_cm} cm (${cmToFtIn(athlete.height_cm)})` : "—";
  const weightStr = athlete?.weight_kg ? `${athlete.weight_kg} kg (${kgToLb(athlete.weight_kg)} lb)` : "—";

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

      {/* -------- Athlete Summary (NEW) -------- */}
      <div className="mt-4 card p-4">
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <h3 className="font-semibold flex items-center gap-2"><UserIcon className="w-4 h-4" /> Athlete Summary</h3>
          <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
            {metricsLoading ? "Loading metrics…" : (metricsError ? metricsError : "")}
          </span>
        </div>

        {/* Top row: name + contact */}
        <div className="mt-3 grid md:grid-cols-3 gap-4">
          <div className="rounded bg-white/5 p-3">
            <div className="text-sm" style={{ color: "var(--muted)" }}>Name</div>
            <div className="text-lg font-semibold">
              {[athlete?.first_name, athlete?.last_name].filter(Boolean).join(" ") || athlete?.display_name || "—"}
            </div>
          </div>
          <div className="rounded bg-white/5 p-3">
            <div className="text-sm flex items-center gap-1" style={{ color: "var(--muted)" }}>
              <Mail className="w-3.5 h-3.5" /> Email
            </div>
            <div className="text-lg font-semibold break-all">{athlete?.email || "—"}</div>
          </div>
          <div className="rounded bg-white/5 p-3">
            <div className="text-sm flex items-center gap-1" style={{ color: "var(--muted)" }}>
              <Phone className="w-3.5 h-3.5" /> Phone
            </div>
            <div className="text-lg font-semibold">{formatPhone(athlete?.phone)}</div>
          </div>
        </div>

        {/* Demographics */}
        <div className="mt-3 grid md:grid-cols-4 gap-4">
          <div className="rounded bg-white/5 p-3">
            <div className="text-sm flex items-center gap-1" style={{ color: "var(--muted)" }}>
              <CalendarDays className="w-3.5 h-3.5" /> DOB / Age
            </div>
            <div className="text-lg font-semibold">
              {(athlete?.dob ? new Date(fromYMD(athlete.dob)).toLocaleDateString() : "—")} {athlete?.dob ? ` • ${ageFromDOB(athlete.dob)}y` : ""}
            </div>
          </div>
          <div className="rounded bg-white/5 p-3">
            <div className="text-sm" style={{ color: "var(--muted)" }}>Gender</div>
            <div className="text-lg font-semibold">{athlete?.gender || "—"}</div>
          </div>
          <div className="rounded bg-white/5 p-3">
            <div className="text-sm" style={{ color: "var(--muted)" }}>Height</div>
            <div className="text-lg font-semibold">{heightStr}</div>
          </div>
          <div className="rounded bg-white/5 p-3">
            <div className="text-sm" style={{ color: "var(--muted)" }}>Weight</div>
            <div className="text-lg font-semibold">{weightStr}</div>
          </div>
        </div>

        {/* KPI metrics with trend */}
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Resting HR"
            unit="bpm"
            icon={<HeartPulse className="w-5 h-5 text-emerald-300" />}
            current={rhr.curr}
            previous={rhr.prev}
          />
          <MetricCard
            title="Max HR"
            unit="bpm"
            icon={<Activity className="w-5 h-5 text-emerald-300" />}
            current={maxhr.curr}
            previous={maxhr.prev}
          />
          <MetricCard
            title="HRV"
            unit="ms"
            icon={<Activity className="w-5 h-5 text-emerald-300" />}
            current={hrv.curr}
            previous={hrv.prev}
          />
          <MetricCard
            title="VO₂max"
            unit=""
            icon={<Activity className="w-5 h-5 text-emerald-300" />}
            current={vo2.curr}
            previous={vo2.prev}
          />
        </div>
      </div>

      {/* Two columns: Left = Add, Right = Tabs */}
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
              <button
                className={`tab ${activeTab === "messages" ? "tab-active" : ""}`}
                onClick={() => setActiveTab("messages")}
              >
                Messages
              </button>
            </div>
          </div>

          {/* READ-ONLY list */}
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
                {Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)).map(day => {
                  const list = items.filter(it => it.session_date === day);
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
            </div>
          ) : activeTab === "builder" ? (
            // EDITABLE overview (no embedded ProgramBuilder)
            <div className="card p-4">
              <h3 className="font-semibold">Builder</h3>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Edit existing sessions or add new ones. Changes save instantly.
              </p>

              <div className="mt-3 space-y-6">
                {Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)).map(day => {
                  const list = items.filter(it => it.session_date === day);
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

                      {/* Existing sessions (editable summary + Edit link) */}
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
                                <div className="ml-auto flex items-center gap-2">
                                  <Link className="btn" href={`/coach-console/${athleteId}/session/${it.id}`}>Edit</Link>
                                  <button className="btn btn-dark" onClick={() => deleteSession(it.id)}>Delete</button>
                                </div>
                              </div>

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
            </div>
          ) : (
            // Messages tab
            <div className="card p-4">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Messages</h3>
                {!authorized ? (
                  <span className="text-sm ml-2" style={{ color: "var(--muted)" }}>
                    (link to this athlete to send and receive messages)
                  </span>
                ) : null}
                <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
                  {focusMessageId ? "Focused on a specific message" : ""}
                </span>
              </div>
              <div className="mt-3">
                <AthleteThread athleteId={athleteId} focusMessageId={focusMessageId} />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------- Metric card component ---------- */
function MetricCard({
  title,
  unit,
  icon,
  current,
  previous,
}: {
  title: string;
  unit?: string;
  icon?: React.ReactNode;
  current: number | null;
  previous: number | null;
}) {
  const tr = trendFrom(previous, current);
  const color = tr === "up" ? "rgb(16,185,129)" : tr === "down" ? "rgb(248,113,113)" : "var(--muted)";
  const Badge = tr === "up" ? TrendingUp : tr === "down" ? TrendingDown : Minus;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-full p-2 bg-white/10">{icon}</div>
        <div className="flex-1">
          <div className="text-sm" style={{ color: "var(--muted)" }}>{title}</div>
          <div className="text-2xl font-semibold">
            {current != null ? current : "—"}{unit ? ` ${unit}` : ""}
          </div>
        </div>
        <div title={previous != null ? `Prev: ${previous}${unit ? ` ${unit}` : ""}` : "No previous value"}>
          <Badge className="w-5 h-5" style={{ color }} />
        </div>
      </div>
    </div>
  );
}
