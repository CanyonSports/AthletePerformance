// app/coach-console/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { Plus, Trash2, Copy, CheckCheck, SkipForward, UserPlus } from "lucide-react";

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "athlete" | "coach" | "admin";
};

type Plan = {
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

export default function CoachConsolePage() {
  const [note, setNote] = useState("");
  const [me, setMe] = useState<Profile | null>(null);
  const [athletes, setAthletes] = useState<Profile[]>([]);
  const [athleteEmail, setAthleteEmail] = useState("");
  const [selectedAthlete, setSelectedAthlete] = useState<string | null>(null);

  const [sport, setSport] = useState<Plan["sport"]>("climbing");
  const [weekStart, setWeekStart] = useState<string>(startOfWeekISO(new Date()));
  const [items, setItems] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);

  const supabase = useMemo(() => {
    if (!isSupabaseConfigured) return null;
    try { return getSupabase(); } catch { return null; }
  }, []);

  const loadCoachData = useCallback(async () => {
    setNote("");
    if (!supabase) { setNote("Supabase env not set"); return; }
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) { setNote("Sign in to use Coach Console."); return; }

      const { data: meRow, error: meErr } = await supabase
        .from("profiles").select("*").eq("id", user.id).single();
      if (meErr) throw meErr;
      setMe(meRow as Profile);

      const { data: links, error: linkErr } = await supabase
        .from("coach_athletes").select("athlete_id").eq("coach_id", user.id);
      if (linkErr) throw linkErr;

      const athleteIds = (links || []).map(l => l.athlete_id);
      if (athleteIds.length) {
        const { data: profs, error: profErr } = await supabase
          .from("profiles").select("*").in("id", athleteIds);
        if (profErr) throw profErr;
        setAthletes(profs as Profile[]);
        if (!selectedAthlete) setSelectedAthlete(athleteIds[0]);
      } else {
        setAthletes([]);
        setSelectedAthlete(null);
      }
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [supabase, selectedAthlete]);

  useEffect(() => { loadCoachData(); }, [loadCoachData]);

  const loadPlan = useCallback(async () => {
    if (!supabase || !selectedAthlete) { setItems([]); return; }
    setLoading(true);
    try {
      const end = addDaysISO(weekStart, 7);
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("user_id", selectedAthlete)
        .gte("session_date", weekStart)
        .lt("session_date", end)
        .order("session_date", { ascending: true });
      if (error) throw error;
      setItems((data || []) as Plan[]);
    } catch (e: any) { setNote(e.message ?? String(e)); }
    finally { setLoading(false); }
  }, [supabase, selectedAthlete, weekStart]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  useEffect(() => {
    if (!supabase || !selectedAthlete) return;
    let mounted = true;
    let channel: any = null;
    (async () => {
      try {
        channel = supabase.channel("coach-plan")
          .on("postgres_changes", {
            event: "*", schema: "public", table: "training_plan_items",
            filter: `user_id=eq.${selectedAthlete}`
          }, () => { if (mounted) loadPlan(); })
          .subscribe();
      } catch { /* ignore */ }
    })();
    return () => {
      mounted = false;
      try {
        if (channel) { supabase.removeChannel(channel); channel?.unsubscribe?.(); }
      } catch {}
    };
  }, [supabase, selectedAthlete, loadPlan]);

  async function addAthleteByEmail() {
    setNote("");
    if (!supabase) return;
    try {
      const email = athleteEmail.trim();
      if (!email) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required");

      const { data: prof, error: pErr } = await supabase
        .from("profiles").select("*").eq("email", email).single();
      if (pErr) throw new Error("No profile found for that email. Ask the athlete to sign up first.");

      const { error: insErr } = await supabase
        .from("coach_athletes").insert({ coach_id: user.id, athlete_id: prof.id });
      if (insErr) throw insErr;

      setAthleteEmail("");
      await loadCoachData();
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }

  async function addSession() {
    if (!supabase || !selectedAthlete) return;
    const newRow: Omit<Plan, "id"> = {
      user_id: selectedAthlete,
      sport,
      session_date: weekStart,
      title: "New Session",
      details: "",
      duration_min: null,
      rpe: null,
      status: "planned"
    };
    const { error } = await supabase.from("training_plan_items").insert(newRow as any);
    if (error) setNote(error.message);
  }
  async function updateField(id: string, patch: Partial<Plan>) {
    if (!supabase) return;
    const { error } = await supabase.from("training_plan_items").update(patch).eq("id", id);
    if (error) setNote(error.message);
  }
  async function deleteSession(id: string) {
    if (!supabase) return;
    const { error } = await supabase.from("training_plan_items").delete().eq("id", id);
    if (error) setNote(error.message);
  }
  async function duplicateToNextWeek() {
    if (!supabase || !selectedAthlete) return;
    const next = addDaysISO(weekStart, 7);
    const { data, error } = await supabase.rpc("duplicate_training_week", {
      p_user_id: selectedAthlete,
      p_week_start: weekStart,
      p_target_week_start: next,
      p_sport: null
    });
    if (error) setNote(error.message);
    else setNote(`Copied ${data ?? 0} sessions to week starting ${next}.`);
  }

  const guard =
    !me ? "Loading profile…" :
    (me.role === "coach" || me.role === "admin") ? "" :
    "You are not a coach. Ask an admin to set your role.";

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <NavBar />

      <div className="card p-4 mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-xl font-semibold">Coach Console</h2>
            {note ? <p className="text-xs text-red-300 mt-1">{note}</p> : null}
            {guard ? <p className="text-xs text-red-300 mt-1">{guard}</p> : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <input
              value={athleteEmail}
              onChange={e=>setAthleteEmail(e.target.value)}
              placeholder="Add athlete by email"
              className="px-3 py-2 rounded bg-white/5 border border-white/10"
            />
            <button className="btn-dark flex items-center gap-2" onClick={addAthleteByEmail}>
              <UserPlus className="w-4 h-4" /> Add
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-300">Athlete:</span>
          <select
            value={selectedAthlete ?? ""}
            onChange={e=>setSelectedAthlete(e.target.value || null)}
            className="px-3 py-2 rounded bg-white/5 border border-white/10"
          >
            {athletes.length === 0 ? <option value="">(none)</option> : null}
            {athletes.map(a => (
              <option key={a.id} value={a.id}>
                {(a.display_name ?? a.email ?? a.id).toString()}
              </option>
            ))}
          </select>

          <span className="text-sm text-slate-300 ml-4">Sport:</span>
          <select value={sport} onChange={e=>setSport(e.target.value as any)} className="px-3 py-2 rounded bg-white/5 border border-white/10">
            <option value="climbing">Climbing</option>
            <option value="ski">Ski</option>
            <option value="mtb">MTB</option>
            <option value="running">Running</option>
          </select>

          <span className="text-sm text-slate-300 ml-4">Week start:</span>
          <input
            type="date"
            value={weekStart}
            onChange={e=>{
              const v = e.target.value ? new Date(e.target.value) : new Date();
              setWeekStart(startOfWeekISO(v));
            }}
            className="px-3 py-2 rounded bg-white/5 border border-white/10"
          />

          <button className="btn-dark flex items-center gap-2 ml-auto" onClick={addSession} disabled={!selectedAthlete || !!guard}>
            <Plus className="w-4 h-4" /> Add Session
          </button>
          <button className="btn-dark flex items-center gap-2" onClick={duplicateToNextWeek} disabled={!selectedAthlete || !!guard}>
            <Copy className="w-4 h-4" /> Copy → Next Week
          </button>
        </div>
      </div>

      <div className="mt-6 card p-4">
        <h3 className="text-lg font-semibold mb-3">Week Sessions</h3>
        {(!selectedAthlete || loading) ? (
          <div className="p-2">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-2 text-slate-300">No sessions for this week.</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {items.map(it => (
              <div key={it.id} className="rounded-2xl border border-white/10 p-4 bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={it.session_date}
                    onChange={e=>updateField(it.id, { session_date: e.target.value })}
                    className="px-2 py-1 rounded bg-white/5 border border-white/10 text-sm"
                  />
                  <select
                    value={it.status}
                    onChange={e=>updateField(it.id, { status: e.target.value as any })}
                    className="px-2 py-1 rounded bg-white/5 border border-white/10 text-sm"
                  >
                    <option value="planned">Planned</option>
                    <option value="completed">Completed</option>
                    <option value="skipped">Skipped</option>
                  </select>

                  <div className="ml-auto flex items-center gap-2">
                    <button className="btn-dark p-2" title="Mark completed" onClick={()=>updateField(it.id, { status: "completed" })}><CheckCheck className="w-4 h-4" /></button>
                    <button className="btn-dark p-2" title="Mark skipped" onClick={()=>updateField(it.id, { status: "skipped" })}><SkipForward className="w-4 h-4" /></button>
                    <button className="btn-dark p-2" title="Delete" onClick={()=>deleteSession(it.id)}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>

                <input
                  className="w-full mt-3 p-2 rounded bg-white/5 border border-white/10"
                  placeholder="Title"
                  value={it.title}
                  onChange={e=>updateField(it.id, { title: e.target.value })}
                />
                <textarea
                  className="w-full mt-2 p-2 rounded bg-white/5 border border-white/10"
                  placeholder="Details"
                  rows={3}
                  value={it.details ?? ""}
                  onChange={e=>updateField(it.id, { details: e.target.value })}
                />
                <div className="flex gap-3 mt-2">
                  <input
                    className="w-32 p-2 rounded bg-white/5 border border-white/10"
                    type="number"
                    placeholder="Duration (min)"
                    value={it.duration_min ?? ""}
                    onChange={e=>updateField(it.id, { duration_min: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                  <input
                    className="w-24 p-2 rounded bg-white/5 border border-white/10"
                    type="number"
                    placeholder="RPE"
                    value={it.rpe ?? ""}
                    onChange={e=>updateField(it.id, { rpe: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
