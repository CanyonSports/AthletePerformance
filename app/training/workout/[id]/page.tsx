// app/training/workout/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import * as Supa from "@/lib/supabaseClient";
import { CheckCircle2, ChevronLeft, ChevronRight, Play, Timer } from "lucide-react";

/* ============================== Types ============================== */
type PlanItem = {
  id: string;
  user_id: string;
  session_date: string; // yyyy-mm-dd
  title: string;
  status: "planned" | "completed" | "skipped";
  details: any | string | null;
};

type StrengthSet = {
  id: string;
  exercise_id: string;
  set_index: number | null;
  target_reps: number | null;
  target_percent_rm: number | null;
  target_rpe: number | null;
  target_load_kg: number | null;
  rest_seconds: number | null;
  notes: string | null;
};

type StrengthExercise = {
  id: string;
  block_id: string;
  name: string | null;
  group_label: string | null;
  demo_url: string | null;
  order_index: number | null;
  sets: StrengthSet[];
};

type StrengthBlock = {
  id: string;
  title: string | null;
  order_index: number | null;
  exercises: StrengthExercise[];
};

type StrengthResult = {
  id?: string;
  user_id: string;
  plan_item_id: string;
  set_id: string;
  actual_reps: number | null;
  actual_load_kg: number | null;
  actual_rpe: number | null;
  rest_seconds: number | null;
  notes: string | null;
  completed: boolean;
};

type SectionType = "endurance" | "strength";

/* ============================== Utils ============================== */
function fromYMD(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}
function parseDetails(details: any | string | null): any {
  if (!details) return {};
  if (typeof details === "string") { try { return JSON.parse(details); } catch { return {}; } }
  if (typeof details === "object") return details;
  return {};
}

/* ============================== Page ============================== */
export default function WorkoutPage() {
  const params = useParams() as { id?: string };
  const sessionId = params?.id || "";

  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);

  const [item, setItem] = useState<PlanItem | null>(null);
  const [blocks, setBlocks] = useState<StrengthBlock[]>([]);

  // linear “workout flow” position
  const [curExerciseIdx, setCurExerciseIdx] = useState(0);

  // results map by set_id
  const [results, setResults] = useState<Record<string, StrengthResult>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, Partial<StrengthResult>>>({});

  const allExercises = useMemo(() => {
    return blocks.flatMap(b => b.exercises.map(ex => ({ ...ex, _blockId: b.id, _blockTitle: b.title })));
  }, [blocks]);

  const curExercise = allExercises[curExerciseIdx];

  /* -------------------- Load plan + results -------------------- */
  const loadPlan = useCallback(async () => {
    if (!supabase || !sessionId) return;
    setLoading(true);
    setNote("");

    try {
      // 1) session
      const { data: itemRow, error: iErr } = await supabase
        .from("training_plan_items")
        .select("id,user_id,session_date,title,status,details")
        .eq("id", sessionId)
        .single();
      if (iErr) throw iErr;
      const plan = itemRow as PlanItem;

      // 2) strength blocks
      const { data: blocksRaw, error: bErr } = await supabase
        .from("strength_blocks")
        .select("id,title,order_index")
        .eq("plan_item_id", plan.id)
        .order("order_index", { ascending: true });
      if (bErr) throw bErr;

      const blockIds = (blocksRaw ?? []).map((b: any) => b.id as string);

      // 3) exercises
      let exs: any[] = [];
      if (blockIds.length) {
        const { data, error } = await supabase
          .from("strength_exercises")
          .select("id,block_id,name,group_label,demo_url,order_index")
          .in("block_id", blockIds)
          .order("order_index", { ascending: true });
        if (error) throw error;
        exs = data ?? [];
      }
      const exIds = exs.map((e) => e.id as string);

      // 4) sets
      let setRows: any[] = [];
      if (exIds.length) {
        const { data, error } = await supabase
          .from("strength_sets")
          .select("id,exercise_id,set_index,target_reps,target_percent_rm,target_rpe,target_load_kg,rest_seconds,notes")
          .in("exercise_id", exIds)
          .order("set_index", { ascending: true });
        if (error) throw error;
        setRows = data ?? [];
      }

      // 5) existing results
      let resRows: any[] = [];
      if (setRows.length) {
        const { data, error } = await supabase
          .from("strength_set_results")
          .select("*")
          .eq("plan_item_id", plan.id)
          .eq("user_id", plan.user_id);
        if (error) {
          // If table doesn't exist yet, ignore and proceed read-only
          console.warn("[workout] results read error:", error);
        } else {
          resRows = data ?? [];
        }
      }

      // assemble structure
      const setsByExercise = setRows.reduce((acc: Record<string, StrengthSet[]>, s: any) => {
        (acc[s.exercise_id] ??= []).push({
          id: s.id,
          exercise_id: s.exercise_id,
          set_index: s.set_index,
          target_reps: s.target_reps,
          target_percent_rm: s.target_percent_rm,
          target_rpe: s.target_rpe,
          target_load_kg: s.target_load_kg,
          rest_seconds: s.rest_seconds,
          notes: s.notes,
        });
        return acc;
      }, {});
      const exByBlock = exs.reduce((acc: Record<string, StrengthExercise[]>, e: any) => {
        (acc[e.block_id] ??= []).push({
          id: e.id,
          block_id: e.block_id,
          name: e.name ?? "",
          group_label: e.group_label ?? null,
          demo_url: e.demo_url ?? null,
          order_index: e.order_index ?? null,
          sets: (setsByExercise[e.id] ?? []).sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0)),
        });
        return acc;
      }, {});
      const strengthBlocks: StrengthBlock[] =
        (blocksRaw ?? []).map((b: any) => ({
          id: b.id,
          title: b.title ?? "Strength",
          order_index: b.order_index ?? 0,
          exercises: (exByBlock[b.id] ?? []),
        }));

      // section order preference
      const parsed = parseDetails(plan.details);
      const orderSaved = Array.isArray(parsed.sectionOrder)
        ? (parsed.sectionOrder.filter((s: unknown): s is SectionType => s === "strength" || s === "endurance"))
        : undefined;

      // only show strength here; endurance tracking can live in your timer page
      const finalBlocks = strengthBlocks;

      // map results by set_id
      const resMap: Record<string, StrengthResult> = {};
      resRows.forEach((r: any) => {
        resMap[r.set_id] = {
          id: r.id,
          user_id: r.user_id,
          plan_item_id: r.plan_item_id,
          set_id: r.set_id,
          actual_reps: r.actual_reps,
          actual_load_kg: r.actual_load_kg,
          actual_rpe: r.actual_rpe,
          rest_seconds: r.rest_seconds,
          notes: r.notes,
          completed: !!r.completed,
        };
      });

      setItem(plan);
      setBlocks(finalBlocks);
      setResults(resMap);
      setCurExerciseIdx(0);
    } catch (e: any) {
      console.error("[workout] load error:", e);
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, sessionId]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  /* -------------------- Save (debounced upsert) -------------------- */
  function scheduleSave(setId: string, patch: Partial<StrengthResult>) {
    pending.current[setId] = { ...(pending.current[setId] || {}), ...patch };
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 500);
  }

  async function flush() {
    if (!supabase || !item) return;
    const work = pending.current;
    pending.current = {};
    const entries = Object.entries(work);
    if (!entries.length) return;

    try {
      const rows = entries.map(([set_id, d]) => ({
        user_id: item.user_id,
        plan_item_id: item.id,
        set_id,
        actual_reps: d.actual_reps ?? results[set_id]?.actual_reps ?? null,
        actual_load_kg: d.actual_load_kg ?? results[set_id]?.actual_load_kg ?? null,
        actual_rpe: d.actual_rpe ?? results[set_id]?.actual_rpe ?? null,
        rest_seconds: d.rest_seconds ?? results[set_id]?.rest_seconds ?? null,
        notes: d.notes ?? results[set_id]?.notes ?? null,
        completed: d.completed ?? results[set_id]?.completed ?? false,
      }));

      // assumes you created a unique constraint on (user_id, plan_item_id, set_id)
      const { error } = await supabase.from("strength_set_results").upsert(rows, { onConflict: "user_id,plan_item_id,set_id" });
      if (error) throw error;
    } catch (e) {
      console.error("[workout] save error:", e);
      // Soft-fail: keep UI responsive even if results table isn't set yet
    }
  }

  function updateResultLocal(setId: string, patch: Partial<StrengthResult>) {
    setResults(prev => {
      const base: StrengthResult = prev[setId] || {
        user_id: item?.user_id || "",
        plan_item_id: item?.id || "",
        set_id: setId,
        actual_reps: null,
        actual_load_kg: null,
        actual_rpe: null,
        rest_seconds: null,
        notes: null,
        completed: false,
      };
      const next = { ...base, ...patch };
      return { ...prev, [setId]: next };
    });
    scheduleSave(setId, patch);
  }

  /* -------------------- UI helpers -------------------- */
  function ExerciseCard({ ex, idx }: { ex: StrengthExercise & { _blockTitle?: string | null }, idx: number }) {
    const plannedSets = ex.sets ?? [];
    const completedCount = plannedSets.reduce((acc, s) => acc + (results[s.id]?.completed ? 1 : 0), 0);

    return (
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <div className="text-xs rounded bg-white/10 px-2 py-[2px]">{ex._blockTitle || "Block"}</div>
          <div className="font-semibold">
            {(ex.group_label ? ex.group_label + " " : "") + (ex.name || "Exercise")}
          </div>
          {ex.demo_url ? (
            <a className="ml-auto text-xs underline opacity-80" href={ex.demo_url} target="_blank" rel="noreferrer">demo</a>
          ) : <div className="ml-auto" />}
        </div>

        {/* progress bar */}
        <div className="mt-2 h-2 w-full rounded bg-white/10">
          <div className="h-2 rounded" style={{
            width: plannedSets.length ? `${Math.round((100 * completedCount) / plannedSets.length)}%` : "0%",
            background: "var(--pine,#10b981)"
          }} />
        </div>

        {/* sets editor */}
        <div className="mt-3 space-y-2">
          {plannedSets.map((s, i) => {
            const r = results[s.id] || ({} as StrengthResult);
            return (
              <div key={s.id} className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                  <div className="text-xs rounded px-2 py-[2px]" style={{ background: "rgba(255,255,255,0.08)" }}>
                    Set {s.set_index ?? i + 1}
                  </div>
                  <div className="text-xs opacity-80">
                    {/* planned summary */}
                    {s.target_reps != null ? `${s.target_reps} reps` : "— reps"}
                    {s.target_percent_rm != null ? ` · ${s.target_percent_rm}%RM` : ""}
                    {s.target_rpe != null ? ` · RPE ${s.target_rpe}` : ""}
                    {s.target_load_kg != null ? ` · ${s.target_load_kg}kg` : ""}
                    {s.rest_seconds != null ? ` · rest ${s.rest_seconds}s` : ""}
                  </div>

                  <label className="ml-auto inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!!r.completed}
                      onChange={(e) => updateResultLocal(s.id, { completed: e.target.checked })}
                    />
                    Completed
                  </label>
                </div>

                {/* actuals */}
                <div className="mt-2 grid md:grid-cols-5 gap-2">
                  <div>
                    <div className="text-[11px] opacity-70">Reps</div>
                    <input
                      className="w-full px-2 py-1 rounded bg-white/5 border border-white/10"
                      inputMode="numeric"
                      value={r.actual_reps ?? ""}
                      onChange={e => updateResultLocal(s.id, { actual_reps: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder={s.target_reps != null ? String(s.target_reps) : "e.g. 8"}
                    />
                  </div>
                  <div>
                    <div className="text-[11px] opacity-70">Load (kg)</div>
                    <input
                      className="w-full px-2 py-1 rounded bg-white/5 border border-white/10"
                      inputMode="decimal"
                      value={r.actual_load_kg ?? ""}
                      onChange={e => updateResultLocal(s.id, { actual_load_kg: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder={s.target_load_kg != null ? String(s.target_load_kg) : "e.g. 60"}
                    />
                  </div>
                  <div>
                    <div className="text-[11px] opacity-70">RPE</div>
                    <input
                      className="w-full px-2 py-1 rounded bg-white/5 border border-white/10"
                      inputMode="numeric"
                      value={r.actual_rpe ?? ""}
                      onChange={e => updateResultLocal(s.id, { actual_rpe: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder={s.target_rpe != null ? String(s.target_rpe) : "1–10"}
                    />
                  </div>
                  <div>
                    <div className="text-[11px] opacity-70">Rest (s)</div>
                    <input
                      className="w-full px-2 py-1 rounded bg-white/5 border border-white/10"
                      inputMode="numeric"
                      value={r.rest_seconds ?? ""}
                      onChange={e => updateResultLocal(s.id, { rest_seconds: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder={s.rest_seconds != null ? String(s.rest_seconds) : "e.g. 90"}
                    />
                  </div>
                  <div>
                    <div className="text-[11px] opacity-70">Notes</div>
                    <input
                      className="w-full px-2 py-1 rounded bg-white/5 border border-white/10"
                      value={r.notes ?? ""}
                      onChange={e => updateResultLocal(s.id, { notes: e.target.value })}
                      placeholder="How it felt, tweaks, etc."
                    />
                  </div>
                </div>
              </div>
            );
          })}
          {plannedSets.length === 0 ? (
            <div className="text-sm opacity-70">No sets yet for this exercise.</div>
          ) : null}
        </div>
      </div>
    );
  }

  /* -------------------- UI -------------------- */
  return (
    <div className="max-w-3xl mx-auto pb-28">
      <NavBar />

      <div className="mt-4 rounded-2xl p-4 md:p-5" style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
        <div className="flex items-start gap-2" style={{ flexWrap: "wrap" }}>
          <Link href={`/training/session/${sessionId}`} className="btn">
            ← Back to Overview
          </Link>
          <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>
            {item?.session_date ? fromYMD(item.session_date).toLocaleDateString() : ""}
          </div>
        </div>

        {loading ? (
          <div className="mt-4">Loading…</div>
        ) : note ? (
          <div className="mt-4 text-red-400 text-sm">{note}</div>
        ) : !item ? (
          <div className="mt-4 text-red-400 text-sm">Session not found.</div>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-2" style={{ flexWrap: "wrap" }}>
              <h1 className="text-xl md:text-2xl font-semibold">{item.title}</h1>
              <span className="text-xs px-2 py-[2px] rounded bg-white/10">{blocks.length} strength block(s)</span>
              <Link className="ml-auto btn btn-dark text-xs"
                    href={`/training/timer/${sessionId}`}
                    title="Open the built-in interval timer">
                <Timer className="w-3 h-3 mr-1" /> Timer
              </Link>
            </div>

            {/* Exercise stepper */}
            <div className="mt-4 flex items-center gap-2">
              <button
                className="btn btn-dark"
                onClick={() => setCurExerciseIdx((i) => Math.max(0, i - 1))}
                disabled={curExerciseIdx <= 0}
                title="Previous exercise"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-sm opacity-80">
                Exercise {allExercises.length ? curExerciseIdx + 1 : 0} / {allExercises.length}
              </div>
              <button
                className="btn"
                onClick={() => setCurExerciseIdx((i) => Math.min(allExercises.length - 1, i + 1))}
                disabled={curExerciseIdx >= allExercises.length - 1}
                title="Next exercise"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* Quick jump pills */}
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {allExercises.slice(0, 8).map((ex, i) => (
                  <button
                    key={ex.id || i}
                    className="px-2 py-1 rounded bg-white/10 text-xs"
                    onClick={() => setCurExerciseIdx(i)}
                    aria-pressed={i === curExerciseIdx}
                    style={{ outline: i === curExerciseIdx ? "1px solid rgba(255,255,255,0.25)" : undefined }}
                    title={(ex.group_label ? `${ex.group_label} ` : "") + (ex.name || "Exercise")}
                  >
                    {ex.group_label || ex.name || `Ex ${i + 1}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Current exercise editor */}
            <div className="mt-3">
              {curExercise ? (
                <ExerciseCard ex={curExercise as any} idx={curExerciseIdx} />
              ) : (
                <div className="rounded-2xl border border-white/10 p-4">
                  <div className="text-sm opacity-70">No strength exercises in this session.</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Sticky footer actions */}
      <div
        className="fixed left-0 right-0 bottom-0"
        style={{ background: "rgba(10,10,12,0.85)", borderTop: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(6px)" }}
      >
        <div className="max-w-3xl mx-auto px-3 py-3">
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            <Link className="btn" href={`/training/session/${sessionId}`}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to Overview
            </Link>
            <button className="btn btn-dark" onClick={() => setCurExerciseIdx((i) => Math.max(0, i - 1))} disabled={!allExercises.length || curExerciseIdx <= 0}>
              Prev
            </button>
            <button className="btn" onClick={() => setCurExerciseIdx((i) => Math.min(allExercises.length - 1, i + 1))} disabled={!allExercises.length || curExerciseIdx >= allExercises.length - 1}>
              Next
            </button>
            <span className="ml-auto text-xs opacity-80">Changes save automatically</span>
          </div>
        </div>
      </div>
    </div>
  );
}
