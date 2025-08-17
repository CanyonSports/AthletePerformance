// app/training/timer/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import * as Supa from "@/lib/supabaseClient";
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Speaker, VolumeX, CheckCircle2, Dumbbell, Timer } from "lucide-react";

/* ------------ Types ------------- */
type PlanItem = {
  id: string;
  user_id: string;
  session_date: string;
  title: string;
  details: any | null; // ProgramBuilder JSON
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

type TimerStep = {
  id: string;
  label: string;        // e.g. "Work", "Rest"
  seconds: number;      // duration of this step
  note?: string;        // optional note
  blockTitle?: string;  // parent block title
  intervalName?: string;// parent interval name
};

type StrengthExercise = { id?: string; name: string; sets: number; reps?: string; rpe?: number };

/* ------------ Helpers ------------- */
function pad2(n: number) { return String(n).padStart(2, "0"); }
function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${pad2(s)}`;
}
function safeUUID() {
  return (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

/* ------------ Page ------------- */
export default function GuidedTimerPage() {
  const params = useParams() as { id?: string };
  const sessionId = params?.id || "";
  const router = useRouter();

  // Supabase fallback helper (supports getSupabase() or exported supabase)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [item, setItem] = useState<PlanItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  // Sound & wakelock
  const [muted, setMuted] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Endurance steps
  const steps = useMemo<TimerStep[]>(() => {
    const out: TimerStep[] = [];
    const d = item?.details;
    const blocks: any[] = d?.blocks || [];
    blocks.forEach((b) => {
      if (b?.type === "endurance_intervals" && Array.isArray(b.intervals)) {
        const blockTitle: string = b.title || "Endurance";
        b.intervals.forEach((iv: any) => {
          const name = iv?.name || "Interval";
          const work = Number(iv?.workSec || 0);
          const rest = Number(iv?.restSec || 0);
          const reps = Number(iv?.reps || 1);
          for (let r = 0; r < Math.max(1, reps); r++) {
            if (work > 0) {
              out.push({
                id: safeUUID(),
                label: "Work",
                seconds: work,
                note: iv?.note,
                blockTitle,
                intervalName: name,
              });
            }
            if (rest > 0) {
              out.push({
                id: safeUUID(),
                label: "Rest",
                seconds: rest,
                note: iv?.note,
                blockTitle,
                intervalName: name,
              });
            }
          }
        });
      }
    });
    return out;
  }, [item]);

  const totalSec = useMemo(() => steps.reduce((s, step) => s + step.seconds, 0), [steps]);

  // Timer state
  const [idx, setIdx] = useState(0);              // current step index
  const [remaining, setRemaining] = useState(steps[0]?.seconds ?? 0);
  const [running, setRunning] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Strength (simple checklist + single rest timer)
  const strength = useMemo(() => {
    const res: { title: string; exercises: StrengthExercise[] }[] = [];
    const d = item?.details;
    const blocks: any[] = d?.blocks || [];
    blocks.forEach((b) => {
      if (b?.type === "strength" && Array.isArray(b.exercises)) {
        res.push({
          title: b.title || "Strength",
          exercises: b.exercises.map((ex: any) => ({
            id: ex?.id,
            name: ex?.name || "Exercise",
            sets: Number(ex?.sets || 0),
            reps: ex?.reps,
            rpe: (ex?.rpe != null ? Number(ex.rpe) : undefined),
          })),
        });
      }
    });
    return res;
  }, [item]);

  const [completedSets, setCompletedSets] = useState<Record<string, number>>({});
  const totalSets = useMemo(() => strength.reduce((sum, b) => sum + b.exercises.reduce((s, e) => s + (e.sets || 0), 0), 0), [strength]);
  const doneSets = useMemo(() => Object.values(completedSets).reduce((a, b) => a + b, 0), [completedSets]);

  // Single rest timer (optional)
  const [restLeft, setRestLeft] = useState<number>(0);
  const restTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ------------ Effects ------------- */
  const loadItem = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setNote("");
    try {
      const { data, error } = await supabase.from("training_plan_items").select("*").eq("id", sessionId).single();
      if (error) throw error;
      setItem(data as PlanItem);
    } catch (e: any) {
      console.error("[timer] loadItem", e);
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, sessionId]);

  useEffect(() => { loadItem(); }, [loadItem]);

  // When steps change or index changes, reset remaining appropriately
  useEffect(() => {
    setIdx(0);
    setRemaining(steps[0]?.seconds ?? 0);
    setRunning(false);
  }, [steps]);

  useEffect(() => {
    setRemaining(steps[idx]?.seconds ?? 0);
  }, [idx, steps]);

  // Main tick
  useEffect(() => {
    if (!running) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    if (!steps.length) return;

    // request wake lock
    requestWakeLock();

    tickRef.current = setInterval(() => {
      setRemaining((t) => {
        if (t > 1) return t - 1;
        // step finished
        beep(880, 120);
        if (idx < steps.length - 1) {
          setIdx((i) => i + 1);
          return steps[idx + 1].seconds;
        } else {
          // last step done
          setRunning(false);
          return 0;
        }
      });
    }, 1000);

    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, idx, steps]);

  // Rest timer tick (single small timer)
  useEffect(() => {
    if (restLeft <= 0) { if (restTickRef.current) { clearInterval(restTickRef.current); restTickRef.current = null; } return; }
    restTickRef.current = setInterval(() => {
      setRestLeft((t) => {
        if (t > 1) return t - 1;
        beep(660, 150);
        return 0;
      });
    }, 1000);
    return () => { if (restTickRef.current) { clearInterval(restTickRef.current); restTickRef.current = null; } };
  }, [restLeft]);

  // Reacquire wake lock on visibility changes
  useEffect(() => {
    const handleVis = () => {
      if (document.visibilityState === "visible" && running) requestWakeLock();
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [running]);

  /* ------------ Audio & WakeLock ------------- */
  function ensureAudio() {
    if (muted) return null;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch { /* ignore */ }
    return audioCtxRef.current;
  }
  function beep(freq = 880, durMs = 120) {
    if (muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.value = 0.04; // quiet
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); o.disconnect(); g.disconnect(); }, durMs);
  }

  async function requestWakeLock() {
    try {
      // @ts-ignore
      if ("wakeLock" in navigator) {
        // @ts-ignore
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current?.addEventListener?.("release", () => {});
      }
    } catch { /* ignore */ }
  }

  /* ------------ Controls ------------- */
  function onPrev() {
    if (!steps.length) return;
    if (remaining > steps[idx].seconds - 1) {
      // If they just started, jump to previous step end
      if (idx > 0) { setIdx(idx - 1); setRemaining(steps[idx - 1].seconds); }
      return;
    }
    if (idx > 0) { setIdx(idx - 1); setRemaining(steps[idx - 1].seconds); }
  }
  function onNext() {
    if (!steps.length) return;
    if (idx < steps.length - 1) { setIdx(idx + 1); setRemaining(steps[idx + 1].seconds); }
    else { setRunning(false); setRemaining(0); }
  }
  function onReset() {
    setIdx(0);
    setRemaining(steps[0]?.seconds ?? 0);
    setRunning(false);
  }

  // Strength helpers
  function incSet(exId: string) {
    setCompletedSets((p) => {
      const cur = p[exId] || 0;
      return { ...p, [exId]: cur + 1 };
    });
  }
  function decSet(exId: string) {
    setCompletedSets((p) => {
      const cur = p[exId] || 0;
      return { ...p, [exId]: Math.max(0, cur - 1) };
    });
  }
  function startRest(seconds = 90) {
    setRestLeft(seconds);
  }

  // Completion
  async function markCompleted() {
    if (!supabase || !item) return;
    const minutes = Math.round(totalSec / 60); // auto-fill from plan steps
    const { error } = await supabase
      .from("training_plan_items")
      .update({ status: "completed", duration_min: minutes })
      .eq("id", item.id);
    if (error) {
      setNote(error.message ?? String(error));
      return;
    }
    router.push("/training");
  }

  /* ------------ Derived UI ------------- */
  const currentStep = steps[idx];
  const finished = steps.length > 0 && idx === steps.length - 1 && remaining === 0;
  const elapsed = useMemo(() => {
    if (!steps.length) return 0;
    let prior = 0;
    for (let i = 0; i < idx; i++) prior += steps[i].seconds;
    return prior + (currentStep ? (currentStep.seconds - remaining) : 0);
  }, [steps, idx, remaining, currentStep]);
  const pct = totalSec ? Math.min(100, Math.round((elapsed / totalSec) * 100)) : 0;

  /* ------------ Render ------------- */
  return (
    <div className="max-w-4xl mx-auto pb-20">
      <NavBar />

      <div className="mt-6 card p-4">
        <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
          <Link className="btn" href={`/training/session/${sessionId}`}>← Back</Link>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn" onClick={() => setMuted(m => !m)}>
              {muted ? <VolumeX className="w-4 h-4 mr-1" /> : <Speaker className="w-4 h-4 mr-1" />}
              {muted ? "Muted" : "Sound On"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mt-3">Loading…</div>
        ) : !item ? (
          <div className="mt-3 text-red-400 text-sm">{note || "Session not found."}</div>
        ) : (
          <div className="mt-4 space-y-6">
            <div>
              <div className="text-xs" style={{color:"var(--muted)"}}>Guided Timer</div>
              <h1 className="text-xl font-semibold">{item.title || "Workout"}</h1>
              <div className="text-xs mt-1 opacity-70">{item.session_date}</div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 rounded bg-white/10 overflow-hidden">
              <div className="h-2 bg-emerald-400" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-xs opacity-70">{pct}% • {mmss(elapsed)} / {mmss(totalSec)}</div>

            {/* Main timer card */}
            <div className="card p-4">
              {steps.length === 0 ? (
                <div className="opacity-70 text-sm">No Endurance Intervals found in this session.</div>
              ) : (
                <>
                  <div className="text-sm opacity-70">
                    Step {idx + 1} of {steps.length} • {currentStep?.blockTitle} — {currentStep?.intervalName}
                  </div>
                  <div className="mt-2 text-4xl font-bold tracking-tight">
                    {mmss(remaining)}
                  </div>
                  <div className="text-lg mt-1">
                    {currentStep?.label === "Work" ? (
                      <span className="text-emerald-300 font-semibold">WORK</span>
                    ) : (
                      <span className="text-sky-300 font-semibold">REST</span>
                    )}
                  </div>
                  {currentStep?.note ? <div className="mt-1 text-sm opacity-80">{currentStep.note}</div> : null}

                  {/* Controls */}
                  <div className="mt-3 flex items-center gap-2" style={{flexWrap:"wrap"}}>
                    <button className="btn" onClick={onPrev}><SkipBack className="w-4 h-4 mr-1" /> Prev</button>
                    {!running ? (
                      <button className="btn btn-dark" onClick={() => { setRunning(true); beep(520, 80); }}>
                        <Play className="w-4 h-4 mr-1" /> Start
                      </button>
                    ) : (
                      <button className="btn btn-dark" onClick={() => setRunning(false)}>
                        <Pause className="w-4 h-4 mr-1" /> Pause
                      </button>
                    )}
                    <button className="btn" onClick={onNext}><SkipForward className="w-4 h-4 mr-1" /> Next</button>
                    <button className="btn" onClick={onReset}><RotateCcw className="w-4 h-4 mr-1" /> Reset</button>
                  </div>
                </>
              )}
            </div>

            {/* Strength checklist + rest timer */}
            {strength.length > 0 && (
              <div className="card p-4">
                <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
                  <Dumbbell className="w-4 h-4" />
                  <h3 className="font-semibold">Strength</h3>
                  <div className="ml-auto text-xs opacity-70">
                    {doneSets}/{totalSets} sets done
                  </div>
                </div>

                <div className="mt-3 space-y-4">
                  {strength.map((b, bi) => (
                    <div key={bi} className="rounded border border-white/10 p-3">
                      <div className="font-semibold">{b.title}</div>
                      {b.exercises.length === 0 ? (
                        <div className="text-sm opacity-70 mt-1">No exercises.</div>
                      ) : (
                        <div className="mt-2 grid" style={{gap:8}}>
                          {b.exercises.map((ex, ei) => {
                            const exId = ex.id || `${b.title}-${ei}`;
                            const done = completedSets[exId] || 0;
                            return (
                              <div key={exId} className="rounded bg-white/5 p-2">
                                <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
                                  <div className="font-medium">{ex.name}</div>
                                  <div className="text-xs opacity-70">
                                    {ex.sets} × {ex.reps || "—"}{ex.rpe ? ` @ RPE ${ex.rpe}` : ""}
                                  </div>
                                  <div className="ml-auto flex items-center gap-2">
                                    <button className="btn" onClick={() => decSet(exId)} disabled={done<=0}>−</button>
                                    <span className="text-sm w-8 text-center">{done}</span>
                                    <button className="btn" onClick={() => incSet(exId)} disabled={done>=ex.sets}>+</button>
                                    <button className="btn" onClick={() => startRest(90)} title="Start 90s rest"><Timer className="w-4 h-4" /></button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Single small rest timer */}
                <div className="mt-3 flex items-center gap-2">
                  <div className="text-sm opacity-70">Rest timer:</div>
                  <div className="font-semibold">{restLeft > 0 ? mmss(restLeft) : "—"}</div>
                  <div className="ml-auto flex items-center gap-2">
                    <button className="btn" onClick={() => startRest(60)}>60s</button>
                    <button className="btn" onClick={() => startRest(90)}>90s</button>
                    <button className="btn" onClick={() => startRest(120)}>120s</button>
                    {restLeft > 0 ? <button className="btn" onClick={() => setRestLeft(0)}>Stop</button> : null}
                  </div>
                </div>
              </div>
            )}

            {/* Finish actions */}
            {steps.length > 0 && !running && finished && (
              <div className="card p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                  <div className="font-semibold">Workout complete</div>
                  <div className="ml-auto text-sm opacity-70">Planned time: {mmss(totalSec)}</div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button className="btn btn-dark" onClick={markCompleted}>
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Mark Session Completed
                  </button>
                  {note ? <span className="text-xs" style={{color:"#fca5a5"}}>{note}</span> : null}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
