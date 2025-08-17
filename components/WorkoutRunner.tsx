// components/WorkoutRunner.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Supa from "@/lib/supabaseClient";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Dumbbell, Timer } from "lucide-react";

/* ---------- Types ---------- */
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
  name: string | null;
  group_label: string | null;
  demo_url: string | null;
  order_index: number | null;
  sets: StrengthSet[];
};
type EnduranceRow = {
  id: string;
  block: "warmup" | "main" | "cooldown";
  order_index: number;
  repeats: number;
  mode: "duration" | "distance";
  duration_sec: number | null;
  distance_m: number | null;
  target_type: "rpe" | "pace" | "hr" | "power";
  target_low: number | null;
  target_high: number | null;
  notes: string | null;
};
type StrengthBlock = { id: string; title: string | null; exercises: StrengthExercise[] };
type EnduranceBlock = { title: string; blockKind: "warmup" | "main" | "cooldown"; intervals: EnduranceRow[] };
type Block = { type: "strength"; data: StrengthBlock } | { type: "endurance"; data: EnduranceBlock };
type SectionType = "endurance" | "strength";

type SetResult = {
  id?: string;
  plan_item_id: string;
  set_id: string;
  exercise_id: string | null;
  user_id: string | null;
  set_index: number | null;
  performed_reps: number | null;
  performed_load_kg: number | null;
  performed_rpe: number | null;
  performed_percent_rm: number | null;
  rest_seconds: number | null;
  notes: string | null;
  completed_at: string | null;
};

type Props = {
  planItemId: string;
  userId: string;
  onExit?: () => void;
};

/* ---------- Small utils ---------- */
function parseDetails(details: any | string | null): any {
  if (!details) return {};
  if (typeof details === "string") { try { return JSON.parse(details); } catch { return {}; } }
  if (typeof details === "object") return details;
  return {};
}
function secondsToHMS(s?: number | null) {
  const v = typeof s === "number" ? s : 0;
  if (!v || v <= 0) return "0:00";
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}` : `${m}:${String(sec).padStart(2,"0")}`;
}
function targetLabel(r: EnduranceRow) {
  const lo = r.target_low ?? undefined;
  const hi = r.target_high ?? undefined;
  const dash = lo != null && hi != null && lo !== hi ? `–${hi}` : "";
  switch (r.target_type) {
    case "rpe":   return lo != null ? `RPE ${lo}${dash}` : "RPE";
    case "hr":    return lo != null ? `${lo}${dash} bpm` : "HR";
    case "power": return lo != null ? `${lo}${dash} W` : "Power";
    case "pace":  return lo != null ? `Pace ${lo}${dash}` : "Pace";
    default:      return "";
  }
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

/* ---------- Runner ---------- */
export default function WorkoutRunner({ planItemId, userId, onExit }: Props) {
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [resultsBySetId, setResultsBySetId] = useState<Record<string, SetResult>>({});
  const [activeIndex, setActiveIndex] = useState(0);

  // local progress for endurance reps
  const [intervalProgress, setIntervalProgress] = useState<Record<string, number>>({}); // key `${bi}:${ii}` -> completed reps

  const steps = useMemo(() => {
    // Flatten to: each exercise = one step, each interval row = one step
    const out: Array<
      | { kind: "strength"; bi: number; exi: number; ex: StrengthExercise; label: string }
      | { kind: "endurance"; bi: number; ii: number; row: EnduranceRow; label: string }
    > = [];

    blocks.forEach((b, bi) => {
      if (b.type === "strength") {
        b.data.exercises.forEach((ex, exi) => {
          const label = `${b.data.title ?? "Strength"} • ${(ex.group_label ? ex.group_label + " " : "") + (ex.name ?? "Exercise")}`;
          out.push({ kind: "strength", bi, exi, ex, label });
        });
      } else {
        b.data.intervals.forEach((row, ii) => {
          const mainText = row.mode === "duration"
            ? `${row.repeats}× ${secondsToHMS(row.duration_sec)}`
            : `${row.repeats}× ${(Number(row.distance_m ?? 0) / 1000).toFixed(2)} km`;
          const label = `${b.data.title} • ${mainText}`;
          out.push({ kind: "endurance", bi, ii, row, label });
        });
      }
    });
    return out;
  }, [blocks]);

  const progressPct = useMemo(() => {
    let planned = 0, done = 0;

    // strength = sets
    blocks.forEach((b, bi) => {
      if (b.type === "strength") {
        b.data.exercises.forEach((ex, exi) => {
          const plannedSets = ex.sets.length;
          planned += plannedSets;
          const completed = ex.sets.reduce((acc, s) => acc + (resultsBySetId[s.id]?.completed_at ? 1 : 0), 0);
          done += clamp(completed, 0, plannedSets);
        });
      } else {
        b.data.intervals.forEach((row, ii) => {
          const reps = Number(row.repeats ?? 0) || 0;
          planned += reps;
          const key = `${bi}:${ii}`;
          const got = intervalProgress[key] ?? 0;
          done += clamp(got, 0, reps);
        });
      }
    });

    return planned > 0 ? Math.round((100 * done) / planned) : 0;
  }, [blocks, resultsBySetId, intervalProgress]);

  /* ---------- Load program assembled ---------- */
  const loadProgram = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    setLoading(true);
    setNote("");
    try {
      const item = await supabase.from("training_plan_items").select("id,details").eq("id", planItemId).single();
      if (item.error) throw item.error;
      const parsed = parseDetails(item.data?.details);

      const sectionOrderSaved: SectionType[] | undefined =
        Array.isArray(parsed?.sectionOrder)
          ? parsed.sectionOrder.filter((s: any): s is SectionType => s === "endurance" || s === "strength")
          : undefined;

      // Endurance
      const ints = await supabase
        .from("training_intervals")
        .select("*")
        .eq("plan_item_id", planItemId)
        .order("block", { ascending: true })
        .order("order_index", { ascending: true });
      if (ints.error) throw ints.error;

      const warmup = (ints.data ?? []).filter((r: { block: string; }) => r.block === "warmup") as EnduranceRow[];
      const main =   (ints.data ?? []).filter((r: { block: string; }) => r.block === "main")   as EnduranceRow[];
      const cool =   (ints.data ?? []).filter((r: { block: string; }) => r.block === "cooldown") as EnduranceRow[];

      const enduranceBlocks: Block[] = [];
      if (warmup.length) enduranceBlocks.push({ type: "endurance", data: { title: "Warm-up", blockKind: "warmup", intervals: warmup } });
      if (main.length)   enduranceBlocks.push({ type: "endurance", data: { title: "Main Set", blockKind: "main", intervals: main } });
      if (cool.length)   enduranceBlocks.push({ type: "endurance", data: { title: "Cool-down", blockKind: "cooldown", intervals: cool } });

      // Strength
      const b = await supabase
        .from("strength_blocks")
        .select("id,title,order_index")
        .eq("plan_item_id", planItemId)
        .order("order_index", { ascending: true });
      if (b.error) throw b.error;

      let strengthBlocks: Block[] = [];
      if ((b.data ?? []).length) {
        const blockIds = (b.data ?? []).map((r: { id: string; }) => r.id as string);

        const e = await supabase
          .from("strength_exercises")
          .select("id,block_id,name,group_label,demo_url,order_index")
          .in("block_id", blockIds)
          .order("order_index", { ascending: true });
        if (e.error) throw e.error;

        const exIds = (e.data ?? []).map((r: { id: string; }) => r.id as string);

        const s = exIds.length
          ? await supabase
              .from("strength_sets")
              .select("id,exercise_id,set_index,target_reps,target_percent_rm,target_rpe,target_load_kg,rest_seconds,notes")
              .in("exercise_id", exIds)
              .order("set_index", { ascending: true })
          : { data: [] as any[], error: null };
        if (s.error) throw s.error;

        const setsByExercise = (s.data ?? []).reduce((acc: Record<string, StrengthSet[]>, row: any) => {
          (acc[row.exercise_id] ??= []).push(row as StrengthSet);
          return acc;
        }, {});

        const exByBlock = (e.data ?? []).reduce((acc: Record<string, StrengthExercise[]>, row: any) => {
          (acc[row.block_id] ??= []).push({
            id: row.id,
            name: row.name,
            group_label: row.group_label,
            demo_url: row.demo_url,
            order_index: row.order_index,
            sets: (setsByExercise[row.id] ?? []).sort((a: { set_index: any; },b: { set_index: any; }) => (a.set_index ?? 0) - (b.set_index ?? 0)),
          });
          return acc;
        }, {});

        strengthBlocks = (b.data ?? []).map((br: any) => ({
          type: "strength" as const,
          data: { id: br.id, title: br.title, exercises: (exByBlock[br.id] ?? []) }
        }));
      }

      const hasEndurance = enduranceBlocks.length > 0;
      const hasStrength = strengthBlocks.length > 0;

      const finalOrder: SectionType[] =
        sectionOrderSaved && sectionOrderSaved.length
          ? sectionOrderSaved
          : ([
              ...(hasEndurance ? (["endurance"] as const) : []),
              ...(hasStrength ? (["strength"] as const) : []),
            ] as SectionType[]);

      const assembled: Block[] = [];
      finalOrder.forEach(sec => {
        if (sec === "endurance" && hasEndurance) assembled.push(...enduranceBlocks);
        if (sec === "strength" && hasStrength) assembled.push(...strengthBlocks);
      });

      setBlocks(assembled);

      // Existing results
      const r = await supabase
        .from("strength_set_results")
        .select("*")
        .eq("plan_item_id", planItemId);
      if (r.error) throw r.error;
      const map: Record<string, SetResult> = {};
      (r.data ?? []).forEach((row: any) => { if (row.set_id) map[row.set_id] = row as SetResult; });
      setResultsBySetId(map);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, planItemId]);

  useEffect(() => { loadProgram(); }, [loadProgram]);

  /* ---------- Strength results upsert ---------- */
  async function upsertResult(setRow: StrengthSet, patch: Partial<SetResult>) {
    if (!isConfigured || !supabase) return;
    const existing = resultsBySetId[setRow.id];

    const payload: SetResult = {
      id: existing?.id,
      plan_item_id: planItemId,
      set_id: setRow.id,
      exercise_id: setRow.exercise_id ?? null,
      user_id: userId ?? null,
      set_index: setRow.set_index ?? null,
      performed_reps: existing?.performed_reps ?? null,
      performed_load_kg: existing?.performed_load_kg ?? null,
      performed_rpe: existing?.performed_rpe ?? null,
      performed_percent_rm: existing?.performed_percent_rm ?? null,
      rest_seconds: existing?.rest_seconds ?? null,
      notes: existing?.notes ?? null,
      completed_at: existing?.completed_at ?? null,
      ...patch,
    };

    const { data, error } = await supabase
      .from("strength_set_results")
      .upsert(payload, { onConflict: "plan_item_id,set_id" })
      .select("*")
      .single();

    if (error) { setNote(error.message ?? String(error)); return; }
    setResultsBySetId(prev => ({ ...prev, [setRow.id]: data as SetResult }));
  }

  /* ---------- Active step UI ---------- */
  function StrengthStep({
    bi, exi, ex,
  }: { bi: number; exi: number; ex: StrengthExercise }) {
    const totalSets = ex.sets.length;
    const completedSets = ex.sets.reduce((acc, s) => acc + (resultsBySetId[s.id]?.completed_at ? 1 : 0), 0);

    return (
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="flex items-center gap-2">
          <div className="rounded-full p-2 bg-white/10"><Dumbbell className="w-5 h-5 text-emerald-300" /></div>
          <div className="font-semibold">
            {(ex.group_label ? `${ex.group_label} ` : "") + (ex.name ?? "Exercise")}
          </div>
          {ex.demo_url ? (
            <a className="ml-auto text-xs underline opacity-80" href={ex.demo_url} target="_blank" rel="noreferrer">
              demo
            </a>
          ) : <div className="ml-auto" />}
        </div>

        {/* Per-exercise progress */}
        <div className="mt-3 h-2 w-full rounded bg-white/10">
          <div
            className="h-2 rounded"
            style={{
              width: totalSets ? `${Math.round((100 * completedSets) / totalSets)}%` : "0%",
              background: "var(--pine,#ef4444)"
            }}
          />
        </div>

        {/* Sets */}
        <div className="mt-4 space-y-2">
          {ex.sets.map((s, idx) => {
            const r = resultsBySetId[s.id];
            const done = Boolean(r?.completed_at);
            const targetParts: string[] = [];
            if (s.target_reps != null) targetParts.push(`${s.target_reps} reps`);
            if (s.target_percent_rm != null) targetParts.push(`${s.target_percent_rm}%RM`);
            if (s.target_rpe != null) targetParts.push(`RPE ${s.target_rpe}`);
            if (s.target_load_kg != null) targetParts.push(`${s.target_load_kg}kg`);
            if (s.rest_seconds != null) targetParts.push(`rest ${s.rest_seconds}s`);

            return (
              <div key={s.id} className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                  <button
                    className="px-2 py-1 rounded-full"
                    style={{ background: done ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.08)" }}
                    onClick={() => upsertResult(s, { completed_at: done ? null : new Date().toISOString() })}
                    title={done ? "Uncheck" : "Mark complete"}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <div className="font-medium">Set {s.set_index ?? idx + 1}</div>
                  <div className="text-xs opacity-80">{targetParts.join(" · ") || "—"}</div>
                  <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
                    {done ? "Completed" : "Tap to complete"}
                  </div>
                </div>

                <div className="mt-2 grid" style={{ gridTemplateColumns: "repeat(4, minmax(80px,120px))", gap: 8 }}>
                  <input
                    className="px-2 py-2 rounded bg-white/5 border border-white/10"
                    placeholder="reps"
                    inputMode="numeric"
                    value={r?.performed_reps ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.trim(); const n = v === "" ? null : Number(v);
                      if (Number.isNaN(n)) return;
                      void upsertResult(s, { performed_reps: n });
                    }}
                  />
                  <input
                    className="px-2 py-2 rounded bg-white/5 border border-white/10"
                    placeholder="kg"
                    inputMode="decimal"
                    value={r?.performed_load_kg ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.trim(); const n = v === "" ? null : Number(v);
                      if (Number.isNaN(n)) return;
                      void upsertResult(s, { performed_load_kg: n });
                    }}
                  />
                  <input
                    className="px-2 py-2 rounded bg-white/5 border border-white/10"
                    placeholder="RPE"
                    inputMode="decimal"
                    value={r?.performed_rpe ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.trim(); const n = v === "" ? null : Number(v);
                      if (Number.isNaN(n)) return;
                      void upsertResult(s, { performed_rpe: n });
                    }}
                  />
                  <input
                    className="px-2 py-2 rounded bg-white/5 border border-white/10"
                    placeholder="%RM"
                    inputMode="decimal"
                    value={r?.performed_percent_rm ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.trim(); const n = v === "" ? null : Number(v);
                      if (Number.isNaN(n)) return;
                      void upsertResult(s, { performed_percent_rm: n });
                    }}
                  />
                </div>

                <textarea
                  className="w-full mt-2 px-2 py-2 rounded bg-white/5 border border-white/10"
                  rows={2}
                  placeholder="Notes"
                  value={r?.notes ?? ""}
                  onChange={(e) => void upsertResult(s, { notes: e.target.value })}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function EnduranceStep({ bi, ii, row }: { bi: number; ii: number; row: EnduranceRow }) {
    const key = `${bi}:${ii}`;
    const reps = Number(row.repeats ?? 0) || 0;
    const done = intervalProgress[key] ?? 0;

    function setDone(next: number) {
      setIntervalProgress(prev => ({ ...prev, [key]: clamp(next, 0, reps) }));
    }

    const mainText =
      row.mode === "duration"
        ? `${reps}× ${secondsToHMS(row.duration_sec)}`
        : `${reps}× ${(Number(row.distance_m ?? 0) / 1000).toFixed(2)} km`;

    return (
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="flex items-center gap-2">
          <div className="font-semibold">{mainText}</div>
          <div className="text-xs opacity-80"> @ {targetLabel(row)}</div>
          <div className="ml-auto">
            <Link
              className="btn btn-dark text-xs"
              href={`/training/timer/${planItemId}?block=${bi}&interval=${ii}`}
              title="Open timer"
            >
              <Timer className="w-3 h-3 mr-1" /> Timer
            </Link>
          </div>
        </div>

        {row.notes ? <div className="mt-2 text-sm opacity-80">{row.notes}</div> : null}

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {Array.from({ length: reps }, (_, i) => i).map(i => {
            const on = i < done;
            return (
              <button
                key={i}
                onClick={() => {
                  if (i === done - 1) setDone(done - 1);
                  else if (i === done) setDone(done + 1);
                  else setDone(i < done ? i : i + 1);
                }}
                className="px-3 py-1 rounded-full text-xs"
                style={{ background: on ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.08)" }}
                aria-pressed={on}
              >
                Rep {i + 1}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1">
            <button className="btn btn-dark" onClick={() => setDone(done - 1)}>-</button>
            <button className="btn" onClick={() => setDone(done + 1)}>+</button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- Navigation ---------- */
  function goPrev() { setActiveIndex(i => clamp(i - 1, 0, Math.max(0, steps.length - 1))); }
  function goNext() { setActiveIndex(i => clamp(i + 1, 0, Math.max(0, steps.length - 1))); }

  /* ---------- Render ---------- */
  if (loading) {
    return (
      <div className="rounded-2xl p-4" style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
        Loading workout…
      </div>
    );
  }
  if (note) {
    return (
      <div className="rounded-2xl p-4" style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
        <div className="text-sm" style={{ color: "#fca5a5" }}>{note}</div>
      </div>
    );
  }
  if (!steps.length) {
    return (
      <div className="rounded-2xl p-4" style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
        <div className="text-sm opacity-80">No steps in this workout yet.</div>
      </div>
    );
  }

  const step = steps[activeIndex];

  return (
    <div className="rounded-2xl p-4 md:p-5" style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
      {/* Header */}
      <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-dark" onClick={onExit}>Exit</button>
        <div className="ml-auto text-sm opacity-80">
          {activeIndex + 1} / {steps.length}
        </div>
      </div>

      {/* Progress */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">Workout Progress</div>
          <div className="ml-auto text-sm">{progressPct}%</div>
        </div>
        <div className="mt-2 h-2 w-full rounded bg-white/10">
          <div className="h-2 rounded" style={{ width: `${progressPct}%`, background: "var(--pine,#ef4444)" }} />
        </div>
      </div>

      {/* Step label */}
      <div className="mt-4 text-sm opacity-80">{step.label}</div>

      {/* Step content */}
      <div className="mt-3">
        {step.kind === "strength" ? (
          <StrengthStep bi={step.bi} exi={step.exi} ex={step.ex} />
        ) : (
          <EnduranceStep bi={step.bi} ii={step.ii} row={step.row} />
        )}
      </div>

      {/* Nav */}
      <div className="mt-4 flex items-center gap-2">
        <button className="btn btn-dark" onClick={goPrev} disabled={activeIndex === 0}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Prev
        </button>
        <button className="btn ml-auto" onClick={goNext} disabled={activeIndex === steps.length - 1}>
          Next <ArrowRight className="w-4 h-4 ml-1" />
        </button>
      </div>
    </div>
  );
}
