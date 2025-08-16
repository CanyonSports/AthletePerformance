// app/coach-console/[athleteId]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import * as Supa from "@/lib/supabaseClient";
import * as NavMod from "@/components/NavBar";
const NavBar: any = (NavMod as any).default ?? (NavMod as any).NavBar ?? (() => null);

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "athlete" | "coach" | "admin" | null;
};

type PlanItem = {
  id?: string;
  user_id: string;
  sport: "climbing" | "ski" | "mtb" | "running";
  session_date: string; // yyyy-mm-dd
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

function startOfWeekISO(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const dayNames = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
function indexToISO(weekStartISO: string, idx: number) { return addDaysISO(weekStartISO, idx); }

function InlineWeekPicker({
  value, onChange, className,
}: { value: string; onChange: (v: string) => void; className?: string; }) {
  const prev = () => onChange(addDaysISO(value, -7));
  const next = () => onChange(addDaysISO(value, +7));
  const handleDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value ? new Date(e.target.value) : new Date();
    onChange(startOfWeekISO(v));
  };
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button className="btn btn-dark" type="button" onClick={prev}>←</button>
      <input type="date" className="field field--date" value={value} onChange={handleDate} />
      <button className="btn btn-dark" type="button" onClick={next}>→</button>
      <span className="text-sm" style={{ color: "var(--muted)" }}>{value} – {addDaysISO(value, 6)}</span>
    </div>
  );
}

export default function CoachAthleteBuilderPage() {
  const router = useRouter();
  const params = useParams<{ athleteId: string }>();
  const sp = useSearchParams();

  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const athleteId = params?.athleteId as string;
  const [me, setMe] = useState<Profile | null>(null);
  const [athlete, setAthlete] = useState<Profile | null>(null);
  const [note, setNote] = useState("");

  const [sport, setSport] = useState<PlanItem["sport"]>((sp?.get("sport") as any) || "climbing");
  const [weekStart, setWeekStart] = useState<string>(sp?.get("week") || startOfWeekISO(new Date()));

  const [existing, setExisting] = useState<PlanItem[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);

  const emptySession = (d: string): Omit<PlanItem,"user_id"|"sport"|"status"> => ({
    session_date: d,
    title: "",
    details: "",
    duration_min: null,
    rpe: null,
  });
  const [draft, setDraft] = useState<Array<Omit<PlanItem,"user_id"|"sport"|"status">>>([
    emptySession(weekStart),
  ]);

  const loadProfiles = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) return;
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) { setNote("Please sign in."); return; }

      const { data: meRow, error: meErr } = await supabase
        .from("profiles").select("*").eq("id", user.id).single();
      if (meErr) throw meErr;
      setMe(meRow as Profile);

      const { data: link, error: linkErr } = await supabase
        .from("coach_athletes")
        .select("athlete_id")
        .eq("coach_id", user.id)
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (linkErr) throw linkErr;
      if (!link) setNote("You are not linked to this athlete.");

      const { data: aRow, error: aErr } = await supabase
        .from("profiles").select("*").eq("id", athleteId).single();
      if (aErr) throw aErr;
      setAthlete(aRow as Profile);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase, athleteId]);

  const loadExistingWeek = useCallback(async () => {
    if (!isConfigured || !supabase || !athleteId) return;
    setLoadingExisting(true);
    try {
      const end = addDaysISO(weekStart, 7);
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("user_id", athleteId)
        .eq("sport", sport)
        .gte("session_date", weekStart)
        .lt("session_date", end)
        .order("session_date",{ ascending: true });
      if (error) throw error;
      setExisting((data || []) as PlanItem[]);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally { setLoadingExisting(false); }
  }, [isConfigured, supabase, athleteId, sport, weekStart]);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);
  useEffect(() => { loadExistingWeek(); }, [loadExistingWeek]);

  useEffect(() => {
    if (!isConfigured || !supabase || !athleteId) return;
    let mounted = true;
    let channel: any = null;
    (async () => {
      try {
        channel = supabase.channel(`coach-plan-${athleteId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "training_plan_items", filter: `user_id=eq.${athleteId}` },
            () => { if (mounted) loadExistingWeek(); })
          .subscribe();
      } catch {}
    })();
    return () => {
      mounted = false;
      try { if (channel) { supabase.removeChannel(channel); channel?.unsubscribe?.(); } } catch {}
    };
  }, [isConfigured, supabase, athleteId, loadExistingWeek]);

  function addDraftSession(dayIdx?: number) {
    const day = typeof dayIdx === "number" ? indexToISO(weekStart, dayIdx) : weekStart;
    setDraft(d => [...d, emptySession(day)]);
  }
  function removeDraftSession(i: number) { setDraft(d => d.filter((_, idx) => idx !== i)); }
  function patchDraft(i: number, patch: Partial<Omit<PlanItem,"user_id"|"sport"|"status">>) {
    setDraft(d => d.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  }

  async function publish(mode: "replace" | "append") {
    setNote("");
    if (!isConfigured || !supabase) return;
    if (!athleteId) { setNote("Missing athlete id."); return; }

    const rows = draft.map(r => ({ ...r, title: (r.title || "").trim() })).filter(r => r.title.length > 0);
    if (rows.length === 0) { setNote("Nothing to publish. Add at least one titled session."); return; }

    const end = addDaysISO(weekStart, 7);
    try {
      if (mode === "replace") {
        const { error: delErr } = await supabase
          .from("training_plan_items")
          .delete()
          .eq("user_id", athleteId)
          .eq("sport", sport)
          .gte("session_date", weekStart)
          .lt("session_date", end);
        if (delErr) throw delErr;
      }

      const payload: PlanItem[] = rows.map(r => ({
        user_id: athleteId,
        sport,
        session_date: r.session_date || weekStart,
        title: r.title,
        details: (r.details ?? "") || null,
        duration_min: (r.duration_min ?? null),
        rpe: (r.rpe ?? null),
        status: "planned",
      }));
      const { error: insErr } = await supabase.from("training_plan_items").insert(payload as any);
      if (insErr) throw insErr;

      setNote(mode === "replace" ? "Published: replaced this week." : "Published: appended to this week.");
      setDraft([emptySession(weekStart)]);
      await loadExistingWeek();
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }

  const athleteLabel = athlete?.display_name || athlete?.email || athleteId;
  const guard =
    !me ? "Loading profile…" :
    (me.role === "coach" || me.role === "admin") ? "" :
    "You are not a coach. Ask an admin to set your role.";

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <NavBar />

      <div className="card p-4 mt-6">
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <div>
            <h2 className="text-xl font-semibold">Program Builder</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Athlete: <strong>{athleteLabel}</strong>
            </p>
            {guard ? <p className="text-xs" style={{ color: "#fca5a5", marginTop: 6 }}>{guard}</p> : null}
            {note ? <p className="text-xs" style={{ color: "#fca5a5", marginTop: 6 }}>{note}</p> : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* 👇 back now returns to /coach-console */}
            <button className="btn btn-dark" type="button" onClick={() => router.push("/coach-console")}>← Back</button>

            <select className="field" value={sport} onChange={e => setSport(e.target.value as any)}>
              <option value="climbing">Climbing</option>
              <option value="ski">Ski</option>
              <option value="mtb">MTB</option>
              <option value="running">Running</option>
            </select>

            <InlineWeekPicker value={weekStart} onChange={setWeekStart} />
          </div>
        </div>
      </div>

      <div className="grid grid-2 mt-6 gap-4">
        {/* LEFT: Builder */}
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Build This Week</h3>
            <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
              Click “Publish” to push to athlete
            </span>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            {dayNames.map((d, i) => (
              <button key={d} className="btn btn-dark" type="button" onClick={() => addDraftSession(i)}>
                + {d}
              </button>
            ))}
            <button className="btn btn-dark" type="button" onClick={() => addDraftSession()}>
              + Add Session
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {draft.map((row, i) => (
              <div key={i} className="card p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    className="field field--date"
                    value={row.session_date}
                    onChange={e => patchDraft(i, { session_date: e.target.value })}
                  />
                  <input
                    className="field flex-1"
                    placeholder="Session title (e.g., Limit Boulders 4x4)"
                    value={row.title}
                    onChange={e => patchDraft(i, { title: e.target.value })}
                  />
                  <button className="btn btn-dark" type="button" onClick={() => removeDraftSession(i)}>Delete</button>
                </div>
                <textarea
                  className="field w-full mt-2"
                  rows={3}
                  placeholder="Details / prescription"
                  value={row.details ?? ""}
                  onChange={e => patchDraft(i, { details: e.target.value })}
                />
                <div className="flex gap-3 mt-2">
                  <input
                    type="number"
                    className="field w-32"
                    placeholder="Duration (min)"
                    value={row.duration_min ?? ""}
                    onChange={e => patchDraft(i, { duration_min: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                  <input
                    type="number"
                    className="field w-24"
                    placeholder="RPE"
                    value={row.rpe ?? ""}
                    onChange={e => patchDraft(i, { rpe: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
              </div>
            ))}
            {draft.length === 0 && (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                No draft sessions yet. Use the buttons above to add.
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-dark" type="button" onClick={() => publish("replace")}>
              Publish — Replace This Week
            </button>
            <button className="btn btn-dark" type="button" onClick={() => publish("append")}>
              Publish — Append
            </button>
          </div>
        </div>

        {/* RIGHT: Existing plan preview */}
        <div className="card p-4">
          <h3 className="text-lg font-semibold">This Week (Saved)</h3>
          {loadingExisting ? (
            <div className="mt-3">Loading…</div>
          ) : existing.length === 0 ? (
            <div className="mt-3" style={{ color: "var(--muted)" }}>
              No sessions saved for this week.
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {existing.map(it => (
                <div key={it.id} className="card p-3">
                  <div className="flex items-center gap-2">
                    <span className="badge">{new Date(it.session_date).toLocaleDateString()}</span>
                    <span className="font-medium">{it.title}</span>
                    <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
                      {it.status}
                    </span>
                  </div>
                  {it.details && <div className="text-sm mt-1 whitespace-pre-wrap">{it.details}</div>}
                  <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                    {it.duration_min != null ? `${it.duration_min} min` : "—"} · RPE {it.rpe ?? "—"}
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
