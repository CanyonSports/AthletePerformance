// app/training/session/[sessionId]/start/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import NavBar from "@/components/NavBar";
import { getSupabase } from "@/lib/supabaseClient";
import { ArrowLeft, CheckCircle2, Pause, Play, RefreshCcw, Timer, Wand2 } from "lucide-react";

/* ----------------------------- Types ----------------------------- */
type PlanItem = {
  id: string;
  user_id: string;
  session_date: string;
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  structure?: any | null;
  created_at?: string;
};
type PlanSet = { reps: string; weight: string; rpe: number | null; notes: string };
type Exercise = { name: string; rest: string; notes: string; planSets: PlanSet[] };
type SetLog = {
  session_id: string;
  exercise_index: number;
  set_index: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  notes: string | null;
  completed: boolean;
  completed_at: string | null;
};

const isUUID = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/* -------------------------- Tiny Rest Timer -------------------------- */
const RestTimer: React.FC = () => {
  const [secs, setSecs] = useState(60);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [running]);
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <div className="rounded-lg border p-2 flex items-center gap-2" style={{ borderColor: "#ffffff1a" }}>
      <Timer className="w-4 h-4" />
      <span className="font-mono">{mm}:{ss}</span>
      <button className="btn" onClick={() => setRunning((r) => !r)}>
        {running ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />} {running ? "Pause" : "Start"}
      </button>
      <button className="btn btn-dark" onClick={() => { setSecs(60); setRunning(false); }}>
        <RefreshCcw className="w-4 h-4 mr-1" /> Reset
      </button>
    </div>
  );
};

/* ------------------------------- Page ------------------------------- */
export default function StartWorkoutPage() {
  const router = useRouter();
  const params = useParams();
  const rawId = params?.["sessionId"];
  const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;

  const supabase = useMemo(() => { try { return getSupabase(); } catch { return null; } }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const [meId, setMeId] = useState<string | null>(null);        // ← NEW
  const [session, setSession] = useState<PlanItem | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [logs, setLogs] = useState<Record<string, SetLog>>({}); // key: `${ei}:${si}`

  /* ------------------------------ Loaders ------------------------------ */
  const loadMe = useCallback(async () => {                      // ← NEW
    if (!isConfigured || !supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setMeId(user?.id ?? null);
    } catch (e: any) {
      setNote(e?.message || String(e));
    }
  }, [isConfigured, supabase]);

  const loadSession = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    if (!isUUID(sessionId)) { setNote("Invalid session id."); return; }
    setLoading(true);
    setNote("");
    try {
      const { data: sRows, error: sErr } = await supabase
        .from("training_plan_items")
        .select("id,user_id,session_date,title,details,duration_min,rpe,status,structure,created_at")
        .eq("id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (sErr) throw sErr;
      const s = (sRows && sRows[0]) as PlanItem | undefined;
      if (!s) { setNote("Session not found or access denied."); setSession(null); return; }
      setSession(s);

      const rawEx = Array.isArray(s.structure?.exercises) ? s.structure.exercises : [];
      const norm: Exercise[] = rawEx.map((e: any) => ({
        name: e?.name || "",
        rest: e?.rest || "",
        notes: e?.notes || "",
        planSets: Array.isArray(e?.planSets) && e.planSets.length > 0
          ? e.planSets.map((ps: any) => ({ reps: ps?.reps || "", weight: ps?.weight || "", rpe: ps?.rpe ?? null, notes: ps?.notes || "" }))
          : [{ reps: e?.reps || "", weight: e?.load || "", rpe: null, notes: "" },
             { reps: e?.reps || "", weight: e?.load || "", rpe: null, notes: "" },
             { reps: e?.reps || "", weight: e?.load || "", rpe: null, notes: "" }],
      }));
      setExercises(norm);

      const { data: lRows, error: lErr } = await supabase
        .from("training_set_logs")
        .select("session_id,exercise_index,set_index,reps,weight,rpe,notes,completed,completed_at")
        .eq("session_id", s.id);
      if (lErr) throw lErr;

      const map: Record<string, SetLog> = {};
      (lRows ?? []).forEach((r: any) => {
        const k = `${r.exercise_index}:${r.set_index}`;
        map[k] = {
          session_id: r.session_id,
          exercise_index: r.exercise_index,
          set_index: r.set_index,
          reps: r.reps == null ? null : Number(r.reps),
          weight: r.weight == null ? null : Number(r.weight),
          rpe: r.rpe == null ? null : Number(r.rpe),
          notes: r.notes ?? null,
          completed: !!r.completed,
          completed_at: r.completed_at,
        };
      });
      setLogs(map);
    } catch (e: any) {
      setNote(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, sessionId]);

  useEffect(() => { loadMe(); }, [loadMe]);                     // ← NEW
  useEffect(() => { loadSession(); }, [loadSession]);

  /* ------------------------------ Helpers ------------------------------ */
  const keyFor = (ei: number, si: number) => `${ei}:${si}`;
  const getLog = (ei: number, si: number): SetLog | null => logs[keyFor(ei, si)] || null;
  const setLocalLog = (next: SetLog) => setLogs((prev) => ({ ...prev, [keyFor(next.exercise_index, next.set_index)]: next }));

  const upsertLog = async (partial: Partial<SetLog> & { exercise_index: number; set_index: number }) => {
    if (!isConfigured || !supabase || !session || !meId) {      // ← ensure user present
      if (!meId) setNote("Sign in required to log sets.");
      return;
    }
    const base: SetLog = {
      session_id: session.id,
      exercise_index: partial.exercise_index,
      set_index: partial.set_index,
      reps: null, weight: null, rpe: null, notes: null,
      completed: false, completed_at: null,
    };
    const current = getLog(partial.exercise_index, partial.set_index) || base;
    const merged: SetLog = { ...current, ...partial, session_id: session.id };
    setLocalLog(merged);

    const payload = {
      session_id: session.id,
      user_id: meId,                                         // ← CRITICAL for RLS + NOT NULL
      exercise_index: merged.exercise_index,
      set_index: merged.set_index,
      reps: merged.reps,
      weight: merged.weight,
      rpe: merged.rpe,
      notes: merged.notes,
      completed: merged.completed,
      completed_at: merged.completed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("training_set_logs")
      .upsert(payload as any, { onConflict: "session_id,exercise_index,set_index" });
    if (error) {
      setNote(error.message || "Save failed");
      await loadSession(); // re-sync
    }
  };

  const parseIntMaybe = (s: string): number | null => {
    const m = s?.match(/^\s*(\d+)(?:\s|$)/);
    return m ? parseInt(m[1], 10) : null;
  };
  const parseWeightMaybe = (s: string): number | null => {
    const m = s?.match(/^\s*(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  };

  const usePlannedForOne = (ei: number, si: number) => {
    const ex = exercises[ei];
    const ps = ex?.planSets?.[si];
    if (!ps || !session) return;
    upsertLog({
      exercise_index: ei,
      set_index: si,
      reps: parseIntMaybe(ps.reps),
      weight: parseWeightMaybe(ps.weight),
      rpe: ps.rpe == null ? null : Number(ps.rpe),
      notes: ps.notes || null,
      completed: true,
    });
  };

  const applyPlannedToEmpties = (ei: number) => {
    const ex = exercises[ei];
    if (!ex || !session) return;
    ex.planSets.forEach((ps, si) => {
      const cur = getLog(ei, si);
      const isEmpty = !cur || (cur.reps == null && cur.weight == null && cur.rpe == null && (cur.notes == null || cur.notes === ""));
      if (isEmpty) {
        upsertLog({
          exercise_index: ei,
          set_index: si,
          reps: parseIntMaybe(ps.reps),
          weight: parseWeightMaybe(ps.weight),
          rpe: ps.rpe == null ? null : Number(ps.rpe),
          notes: ps.notes || null,
          completed: false,
        });
      }
    });
  };

  const finishWorkout = async () => {
    if (!isConfigured || !supabase || !session) return;
    try {
      const { error } = await supabase
        .from("training_plan_items")
        .update({ status: "completed" })
        .eq("id", session.id);
      if (error) throw error;
      router.push(`/training/session/${session.id}`);
    } catch (e: any) {
      setNote(e?.message || String(e));
    }
  };

  /* ------------------------------ UI ------------------------------ */
  return (
    <div className="max-w-5xl mx-auto pb-20">
      <NavBar />

      {/* Header / Nav */}
      <div className="mt-4 rounded-2xl p-5 md:p-6" style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Link href={`/training/session/${sessionId}`} className="btn">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to Session
            </Link>
            <Link href="/training/calendar" className="btn">Calendar</Link>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <RestTimer />
          </div>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-semibold">{session?.title || "Workout"}</h1>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {session ? new Date(session.session_date).toLocaleDateString() : ""}
            {session?.duration_min ? <> • {session.duration_min} min planned</> : null}
            {session?.rpe ? <> • RPE {session.rpe}</> : null}
          </div>
          {note ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div> : null}
        </div>
      </div>

      {/* Workout body */}
      <div className="mt-6 space-y-4">
        {exercises.length === 0 ? (
          <div className="card p-4 text-sm" style={{ color: "var(--muted)" }}>
            No structured exercises found for this session.
          </div>
        ) : (
          exercises.map((ex, ei) => {
            const setRows = ex.planSets.length > 0 ? ex.planSets.map((_, i) => i) : [0, 1, 2];
            return (
              <div key={ei} className="card p-4">
                <div className="flex items-center gap-2">
                  <div className="rounded-full p-2 bg-white/10"><CheckCircle2 className="w-5 h-5 text-emerald-300" /></div>
                  <div>
                    <div className="font-semibold">{ex.name || `Exercise ${ei + 1}`}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {ex.rest ? <>Rest: {ex.rest}</> : null}
                    </div>
                  </div>
                  <div className="ml-auto">
                    <button className="btn" onClick={() => applyPlannedToEmpties(ei)}>
                      <Wand2 className="w-4 h-4 mr-1" /> Apply planned to empties
                    </button>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-xs" style={{ color: "var(--muted)" }}>
                      <tr>
                        <th className="text-left py-1 pr-3">Set</th>
                        <th className="text-left py-1 pr-3">Reps</th>
                        <th className="text-left py-1 pr-3">Weight</th>
                        <th className="text-left py-1 pr-3">RPE</th>
                        <th className="text-left py-1 pr-3">Notes</th>
                        <th className="text-left py-1 pr-3">Quick</th>
                      </tr>
                    </thead>
                    <tbody>
                      {setRows.map((si) => {
                        const current = getLog(ei, si) || {
                          session_id: session?.id || "",
                          exercise_index: ei,
                          set_index: si,
                          reps: null, weight: null, rpe: null, notes: null,
                          completed: false, completed_at: null,
                        };
                        const plan = ex.planSets[si] || { reps: "", weight: "", rpe: null, notes: "" };
                        return (
                          <tr key={si} className="border-t" style={{ borderColor: "#ffffff14" }}>
                            <td className="py-1 pr-3 font-medium">#{si + 1}</td>
                            <td className="py-1 pr-3">
                              <input
                                type="number"
                                className="field w-24"
                                value={current.reps ?? ""}
                                placeholder={plan.reps || "reps"}
                                onChange={(e) => upsertLog({ exercise_index: ei, set_index: si, reps: e.target.value ? parseInt(e.target.value, 10) : null })}
                              />
                            </td>
                            <td className="py-1 pr-3">
                              <input
                                type="number"
                                className="field w-28"
                                step="any"
                                value={current.weight ?? ""}
                                placeholder={plan.weight || "kg/lb"}
                                onChange={(e) => upsertLog({ exercise_index: ei, set_index: si, weight: e.target.value ? Number(e.target.value) : null })}
                              />
                            </td>
                            <td className="py-1 pr-3">
                              <input
                                type="number"
                                className="field w-20"
                                value={current.rpe ?? ""}
                                placeholder={plan.rpe == null ? "RPE" : String(plan.rpe)}
                                onChange={(e) => upsertLog({ exercise_index: ei, set_index: si, rpe: e.target.value ? parseInt(e.target.value, 10) : null })}
                              />
                            </td>
                            <td className="py-1 pr-3">
                              <input
                                className="field w-56"
                                value={current.notes ?? ""}
                                placeholder={plan.notes || "form / tempo / cues"}
                                onChange={(e) => upsertLog({ exercise_index: ei, set_index: si, notes: e.target.value || null })}
                              />
                            </td>
                            <td className="py-1 pr-3">
                              <button className="btn btn-dark" onClick={() => usePlannedForOne(ei, si)}>
                                Use planned
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {ex.notes ? (
                  <div className="mt-2 text-xs opacity-80" style={{ color: "var(--muted)" }}>
                    Coach notes: {ex.notes}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Footer actions */}
      <div className="mt-6 flex items-center justify-end gap-2">
        <Link href={`/training/session/${sessionId}`} className="btn">Back to Session</Link>
        <button className="btn btn-dark" onClick={finishWorkout}>
          <CheckCircle2 className="w-4 h-4 mr-1" /> Finish Workout
        </button>
      </div>
    </div>
  );
}
