// app/training/session/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import * as Supa from "@/lib/supabaseClient";
import { CheckCircle2, Play, RotateCcw, SkipForward, Timer, ChevronRight } from "lucide-react";
import { errMsg } from "@/lib/err";

/* ---------- Types ---------- */
type PlanItem = {
  id: string;
  user_id: string;
  session_date: string; // yyyy-mm-dd
  title: string;
  details: any | string | null;  // may hold sectionOrder or legacy blocks
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

type StrengthSet = {
  id?: string;
  set_index?: number;
  target_reps?: number | null;
  target_percent_rm?: number | null;
  target_rpe?: number | null;
  target_load_kg?: number | null;
  rest_seconds?: number | null;
  notes?: string | null;
};

type StrengthExercise = {
  id?: string;
  name?: string;
  group_label?: string | null;
  demo_url?: string | null;
  order_index?: number | null;
  sets: StrengthSet[];
};

/** Endurance rows follow your EnduranceEditor schema */
type EnduranceRow = {
  id?: string;
  block?: "warmup" | "main" | "cooldown";
  order_index?: number;
  repeats?: number;
  mode?: "duration" | "distance";
  duration_sec?: number | null;
  distance_m?: number | null;
  target_type?: "rpe" | "pace" | "hr" | "power";
  target_low?: number | null;
  target_high?: number | null;
  notes?: string | null;
};

type Block =
  | { id?: string; type: "strength"; title?: string; exercises: StrengthExercise[] }
  | { id?: string; type: "endurance"; title?: string; blockKind: "warmup" | "main" | "cooldown"; intervals: EnduranceRow[] };

type SectionType = "endurance" | "strength";

/* ---------- Small utils ---------- */
function fromYMD(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
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

/** Estimate minutes from endurance duration rows (ignores distance-only rows) */
function estimatePlannedMinutes(blocks: Block[]): number {
  let sec = 0;
  blocks.forEach(b => {
    if (b.type === "endurance") {
      b.intervals.forEach(row => {
        const reps = row.repeats ?? 1;
        const dur = row.mode === "duration" ? (row.duration_sec ?? 0) : 0;
        sec += reps * dur;
      });
    }
  });
  return Math.round(sec / 60);
}

/* ---------- Local progress ---------- */
type Progress = {
  blocks: Record<
    string,
    {
      strength?: Record<string, { completedSets: number }>;
      intervals?: Record<string, { completedReps: number }>;
    }
  >;
};
function loadProgress(sessionId: string): Progress {
  try { const raw = localStorage.getItem(`sessionProgress:${sessionId}`); if (raw) return JSON.parse(raw); } catch {}
  return { blocks: {} };
}
function saveProgress(sessionId: string, p: Progress) {
  try { localStorage.setItem(`sessionProgress:${sessionId}`, JSON.stringify(p)); } catch {}
}

/* ====================================================================== */
/*                                PAGE                                    */
/* ====================================================================== */
export default function AthleteSessionPage() {
  const params = useParams() as { id?: string };
  const sessionId = params?.id || "";

  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  // Data
  const [item, setItem] = useState<PlanItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  // Inputs
  const [duration, setDuration] = useState<string>("");
  const [rpe, setRpe] = useState<string>("");

  // Builder + progress
  const builderDataRef = useRef<{ blocks: Block[]; sectionOrder?: SectionType[] } | null>(null);
  const [progress, setProgress] = useState<Progress>({ blocks: {} });

  // Derived
  const blocks: Block[] = useMemo(() => builderDataRef.current?.blocks ?? [], [builderDataRef.current]);
  const plannedMinutes = useMemo(() => estimatePlannedMinutes(blocks), [blocks]);

  /* ---------- Fetch & assemble program ---------- */
  const loadStructuredProgram = useCallback(
    async (planId: string, details: any) => {
      if (!supabase) return;

      const parsed = parseDetails(details);
      const sectionOrderSaved = Array.isArray(parsed.sectionOrder)
        ? (parsed.sectionOrder.filter((s: unknown): s is SectionType => s === "endurance" || s === "strength"))
        : undefined;

      // Endurance: training_intervals (group by block)
      const { data: ints } = await supabase
        .from("training_intervals")
        .select("id,block,order_index,repeats,mode,duration_sec,distance_m,target_type,target_low,target_high,notes")
        .eq("plan_item_id", planId)
        .order("block", { ascending: true })
        .order("order_index", { ascending: true });

      const warmup = (ints ?? []).filter((r: { block: string; }) => r.block === "warmup") as EnduranceRow[];
      const main   = (ints ?? []).filter((r: { block: string; }) => r.block === "main") as EnduranceRow[];
      const cool   = (ints ?? []).filter((r: { block: string; }) => r.block === "cooldown") as EnduranceRow[];

      const enduranceBlocks: Block[] = [];
      if (warmup.length) enduranceBlocks.push({ type: "endurance", title: "Warm-up", blockKind: "warmup", intervals: warmup });
      if (main.length)   enduranceBlocks.push({ type: "endurance", title: "Main Set", blockKind: "main", intervals: main });
      if (cool.length)   enduranceBlocks.push({ type: "endurance", title: "Cool-down", blockKind: "cooldown", intervals: cool });

      // Strength: blocks, exercises, sets
      const { data: blocksRaw } = await supabase
        .from("strength_blocks")
        .select("id,title,order_index")
        .eq("plan_item_id", planId)
        .order("order_index", { ascending: true });

      let exByBlock: Record<string, StrengthExercise[]> = {};

      if ((blocksRaw ?? []).length > 0) {
        const blockIds = (blocksRaw ?? []).map((b: { id: string; }) => b.id as string);

        const { data: exs } = await supabase
          .from("strength_exercises")
          .select("id,block_id,name,group_label,demo_url,order_index")
          .in("block_id", blockIds)
          .order("order_index", { ascending: true });

        const exIds = (exs ?? []).map((e: { id: string; }) => e.id as string);

        let setsByExercise: Record<string, StrengthSet[]> = {};
        if (exIds.length) {
          const { data: setsRows } = await supabase
            .from("strength_sets")
            .select("id,exercise_id,set_index,target_reps,target_percent_rm,target_rpe,target_load_kg,rest_seconds,notes")
            .in("exercise_id", exIds)
            .order("set_index", { ascending: true });

          setsByExercise = (setsRows ?? []).reduce((acc: Record<string, StrengthSet[]>, s: any) => {
            (acc[s.exercise_id] ??= []).push({
              id: s.id,
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
        }

        exByBlock = (exs ?? []).reduce((acc: Record<string, StrengthExercise[]>, e: any) => {
          (acc[e.block_id] ??= []).push({
            id: e.id,
            name: e.name ?? "",
            group_label: e.group_label ?? null,
            demo_url: e.demo_url ?? null,
            order_index: e.order_index ?? null,
            sets: setsByExercise[e.id] ?? [],
          });
          return acc;
        }, {});
      }

      const strengthBlocks: Block[] = (blocksRaw ?? []).map((b: { id: string; title: any; }) => ({
        id: b.id,
        type: "strength" as const,
        title: b.title ?? "Strength",
        exercises: (exByBlock[b.id as string] ?? []),
      }));

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

      // Fallback: legacy JSON in details.blocks
      const legacyBlocks: Block[] = Array.isArray(parsed?.blocks) ? (parsed.blocks as any) : [];
      const finalBlocks = assembled.length ? assembled : legacyBlocks;

      builderDataRef.current = { blocks: finalBlocks, sectionOrder: finalOrder };
    },
    [supabase]
  );

  /* ---------- Load session ---------- */
  const loadItem = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setNote("");
    try {
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("id", sessionId)
        .single();
      if (error) throw error;

      setItem(data as PlanItem);
      setDuration(data?.duration_min != null ? String(data.duration_min) : "");
      setRpe(data?.rpe != null ? String(data.rpe) : "");

      await loadStructuredProgram(data.id, data.details);
      setProgress(loadProgress(sessionId));
    } catch (e) {
      console.error("[session] loadItem error:", e);
      setNote(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, sessionId, loadStructuredProgram]);

  useEffect(() => { loadItem(); }, [loadItem]);

  /* ---------- Progress helpers ---------- */
  function updateStrengthProgress(bi: number, exi: number, setsPlanned = 0, delta = 1) {
    setProgress(prev => {
      const p = JSON.parse(JSON.stringify(prev)) as Progress;
      const bkey = String(bi), ekey = String(exi);
      p.blocks[bkey] ??= {};
      p.blocks[bkey].strength ??= {};
      const cur = p.blocks[bkey].strength![ekey]?.completedSets ?? 0;
      const next = clamp(cur + delta, 0, setsPlanned);
      p.blocks[bkey].strength![ekey] = { completedSets: next };
      saveProgress(sessionId, p);
      return p;
    });
  }
  function updateIntervalProgress(bi: number, ii: number, repsPlanned = 0, delta = 1) {
    setProgress(prev => {
      const p = JSON.parse(JSON.stringify(prev)) as Progress;
      const bkey = String(bi), ikey = String(ii);
      p.blocks[bkey] ??= {};
      p.blocks[bkey].intervals ??= {};
      const cur = p.blocks[bkey].intervals![ikey]?.completedReps ?? 0;
      const next = clamp(cur + delta, 0, repsPlanned);
      p.blocks[bkey].intervals![ikey] = { completedReps: next };
      saveProgress(sessionId, p);
      return p;
    });
  }
  function resetProgress() {
    const empty: Progress = { blocks: {} };
    setProgress(empty);
    saveProgress(sessionId, empty);
  }

  /* ---------- Completion helpers ---------- */
  async function markCompleted() {
    if (!supabase || !item) return;
    setNote("");
    try {
      const d = duration.trim() ? Number(duration.trim()) : (plannedMinutes || null);
      const r = rpe.trim() ? Number(rpe.trim()) : null;
      const { error } = await supabase
        .from("training_plan_items")
        .update({ status: "completed", duration_min: d, rpe: r })
        .eq("id", item.id);
      if (error) throw error;
      setItem(prev => prev ? { ...prev, status: "completed", duration_min: d, rpe: r } : prev);
    } catch (e) {
      console.error("[session] markCompleted error:", e);
      setNote(errMsg(e));
    }
  }
  async function markSkipped() {
    if (!supabase || !item) return;
    setNote("");
    try {
      const { error } = await supabase
        .from("training_plan_items")
        .update({ status: "skipped" })
        .eq("id", item.id);
      if (error) throw error;
      setItem(prev => prev ? { ...prev, status: "skipped" } : prev);
    } catch (e) {
      console.error("[session] markSkipped error:", e);
      setNote(errMsg(e));
    }
  }

  /* ---------- Progress % ---------- */
  const progressPct = useMemo(() => {
    let planned = 0, done = 0;
    blocks.forEach((b, bi) => {
      if (b.type === "strength") {
        b.exercises.forEach((ex, exi) => {
          const setsPlanned = ex.sets?.length ?? 0;
          planned += setsPlanned;
          const got = progress.blocks[String(bi)]?.strength?.[String(exi)]?.completedSets ?? 0;
          done += clamp(got, 0, setsPlanned);
        });
      } else if (b.type === "endurance") {
        b.intervals.forEach((row, ii) => {
          const reps = Number(row.repeats ?? 0) || 0;
          planned += reps;
          const got = progress.blocks[String(bi)]?.intervals?.[String(ii)]?.completedReps ?? 0;
          done += clamp(got, 0, reps);
        });
      }
    });
    return planned > 0 ? Math.round((100 * done) / planned) : 0;
  }, [blocks, progress]);

  /* ---------- Renderers ---------- */
  function StatusPill({ status }: { status: PlanItem["status"] }) {
    const color =
      status === "completed" ? "rgba(16,185,129,0.18)" :
      status === "skipped" ? "rgba(244,63,94,0.18)" : "rgba(255,255,255,0.08)";
    const text =
      status === "completed" ? "Completed" :
      status === "skipped" ? "Skipped" : "Planned";
    return (
      <span className="text-xs px-2 py-[2px] rounded" style={{ background: color }}>
        {text}
      </span>
    );
  }

  function StrengthBlock({ b, bi }: { b: Extract<Block, {type:"strength"}>; bi: number }) {
    const exs = b.exercises ?? [];
    return (
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="flex items-center gap-2">
          <div className="font-semibold">{b.title || "Strength"}</div>
          <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
            {exs.length} exercises
          </div>
        </div>

        {/* per-block progress */}
        <div className="mt-2 h-2 w-full rounded bg-white/10">
          {(() => {
            let planned = 0, done = 0;
            exs.forEach((ex, exi) => {
              const setsPlanned = ex.sets?.length ?? 0;
              planned += setsPlanned;
              const got = progress.blocks[String(bi)]?.strength?.[String(exi)]?.completedSets ?? 0;
              done += clamp(got, 0, setsPlanned);
            });
            const w = planned > 0 ? `${Math.round((100 * done) / planned)}%` : "0%";
            return <div className="h-2 rounded" style={{ width: w, background: "var(--pine,#ef4444)" }} />;
          })()}
        </div>

        <div className="mt-3 space-y-2">
          {exs.map((ex, exi) => {
            const setsPlanned = ex.sets?.length ?? 0;
            const doneSets = progress.blocks[String(bi)]?.strength?.[String(exi)]?.completedSets ?? 0;
            return (
              <div key={ex.id || exi} className="rounded-xl bg-white/5 p-3">
                {/* Header */}
                <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                  <div className="font-medium">
                    {(ex.group_label ? ex.group_label + " " : "") + (ex.name || "Exercise")}
                  </div>
                  {ex.demo_url ? (
                    <a href={ex.demo_url} target="_blank" rel="noreferrer" className="text-xs underline opacity-80">demo</a>
                  ) : null}
                  <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
                    {setsPlanned} set{setsPlanned === 1 ? "" : "s"}
                  </div>
                </div>

                {/* set chips */}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {Array.from({ length: setsPlanned }, (_, i) => i).map(i => {
                    const on = i < doneSets;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (i === doneSets - 1) updateStrengthProgress(bi, exi, setsPlanned, -1);
                          else if (i === doneSets) updateStrengthProgress(bi, exi, setsPlanned, +1);
                          else updateStrengthProgress(bi, exi, setsPlanned, i < doneSets ? -(doneSets - i) : (i + 1 - doneSets));
                        }}
                        className="px-3 py-1 rounded-full text-xs"
                        style={{ background: on ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.08)" }}
                        aria-pressed={on}
                      >
                        Set {i + 1}
                      </button>
                    );
                  })}
                  <div className="ml-auto flex items-center gap-1">
                    <button className="btn btn-dark" onClick={() => updateStrengthProgress(bi, exi, setsPlanned, -1)}>-</button>
                    <button className="btn" onClick={() => updateStrengthProgress(bi, exi, setsPlanned, +1)}>+</button>
                  </div>
                </div>

                {/* per-set details */}
                {setsPlanned > 0 ? (
                  <div className="mt-2 grid gap-1">
                    {ex.sets
                      .slice()
                      .sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0))
                      .map((s, i) => (
                        <div key={s.id || i} className="text-xs opacity-80">
                          <span className="opacity-70">Set {s.set_index ?? i + 1}:</span>{" "}
                          {s.target_reps != null ? `${s.target_reps} reps` : "reps —"}
                          {s.target_percent_rm != null ? ` · ${s.target_percent_rm}%RM` : ""}
                          {s.target_rpe != null ? ` · RPE ${s.target_rpe}` : ""}
                          {s.target_load_kg != null ? ` · ${s.target_load_kg}kg` : ""}
                          {s.rest_seconds != null ? ` · rest ${s.rest_seconds}s` : ""}
                          {s.notes ? ` — ${s.notes}` : ""}
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs opacity-70">No sets yet</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function EnduranceBlock({ b, bi }: { b: Extract<Block, {type:"endurance"}>; bi: number }) {
    const label = b.title || (b.blockKind === "warmup" ? "Warm-up" : b.blockKind === "main" ? "Main Set" : "Cool-down");
    const rows = b.intervals ?? [];
    return (
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="flex items-center gap-2">
          <div className="font-semibold">{label}</div>
          <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </div>
        </div>

        {/* per-block progress */}
        <div className="mt-2 h-2 w-full rounded bg-white/10">
          {(() => {
            let planned = 0, done = 0;
            rows.forEach((row, ii) => {
              const reps = Number(row.repeats ?? 0) || 0;
              planned += reps;
              const got = progress.blocks[String(bi)]?.intervals?.[String(ii)]?.completedReps ?? 0;
              done += clamp(got, 0, reps);
            });
            const w = planned > 0 ? `${Math.round((100 * done) / planned)}%` : "0%";
            return <div className="h-2 rounded" style={{ width: w, background: "var(--pine,#ef4444)" }} />;
          })()}
        </div>

        <div className="mt-3 space-y-2">
          {rows.map((row, ii) => {
            const reps = Number(row.repeats ?? 0) || 0;
            const doneReps = progress.blocks[String(bi)]?.intervals?.[String(ii)]?.completedReps ?? 0;

            const mainText =
              row.mode === "duration"
                ? `${reps}× ${secondsToHMS(row.duration_sec)}`
                : `${reps}× ${(Number(row.distance_m ?? 0) / 1000).toFixed(2)} km`;

            return (
              <div key={row.id || ii} className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{mainText}</div>
                  <div className="text-xs opacity-80"> @ {targetLabel(row)}</div>
                  <div className="ml-auto">
                    <Link
                      className="btn btn-dark text-xs"
                      href={`/training/timer/${sessionId}?block=${bi}&interval=${ii}`}
                      title="Open timer"
                    >
                      <Timer className="w-3 h-3 mr-1" /> Timer
                    </Link>
                  </div>
                </div>

                {/* rep chips */}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {Array.from({ length: reps }, (_, i) => i).map(i => {
                    const on = i < doneReps;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (i === doneReps - 1) updateIntervalProgress(bi, ii, reps, -1);
                          else if (i === doneReps) updateIntervalProgress(bi, ii, reps, +1);
                          else updateIntervalProgress(bi, ii, reps, i < doneReps ? -(doneReps - i) : (i + 1 - doneReps));
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
                    <button className="btn btn-dark" onClick={() => updateIntervalProgress(bi, ii, reps, -1)}>-</button>
                    <button className="btn" onClick={() => updateIntervalProgress(bi, ii, reps, +1)}>+</button>
                  </div>
                </div>

                {row.notes ? <div className="mt-2 text-xs opacity-80">{row.notes}</div> : null}

                <Link className="mt-2 inline-flex items-center gap-1 text-xs underline opacity-90"
                      href={`/training/timer/${sessionId}?block=${bi}&interval=${ii}`}>
                  Open Timer <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderBlocks() {
    if (!blocks.length) {
      return <div className="text-sm opacity-80">No structured details for this session yet.</div>;
    }
    return (
      <div className="space-y-4">
        {blocks.map((b, i) => {
          switch (b.type) {
            case "strength":   return <StrengthBlock key={b.id ?? i} b={b} bi={i} />;
            case "endurance":  return <EnduranceBlock key={b.id ?? i} b={b} bi={i} />;
            default:           return (
              <div key={i} className="rounded-2xl border border-white/10 p-4">
                <div className="font-semibold">Block</div>
                <div className="text-sm opacity-70 mt-2">Unsupported block type</div>
              </div>
            );
          }
        })}
      </div>
    );
  }

  /* ---------- UI ---------- */
  return (
    <div className="max-w-3xl mx-auto pb-28">
      <NavBar />

      <div className="mt-4 rounded-2xl p-4 md:p-5" style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
        <div className="flex items-start gap-2" style={{ flexWrap: "wrap" }}>
          <Link href="/training" className="btn">← Back</Link>
          <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>
            {item?.session_date ? fromYMD(item.session_date).toLocaleDateString() : ""}
          </div>
        </div>

        {loading ? (
          <div className="mt-3">Loading…</div>
        ) : !item ? (
          <div className="mt-3 text-red-400 text-sm">{note || "Session not found."}</div>
        ) : (
          <div className="mt-3 space-y-4">
            {/* Title & status */}
            <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
              <h1 className="text-xl md:text-2xl font-semibold">{item.title}</h1>
              <StatusPill status={item.status} />
            </div>

            {/* Quick metrics */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/5 p-3">
                <div className="text-xs" style={{ color: "var(--muted)" }}>Duration (min)</div>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                    inputMode="numeric"
                    value={duration}
                    onChange={e => setDuration(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder={plannedMinutes ? String(plannedMinutes) : "60"}
                  />
                  {plannedMinutes ? (
                    <button className="btn btn-dark text-xs whitespace-nowrap"
                            onClick={() => setDuration(String(plannedMinutes))}
                            title="Use planned">
                      Use {plannedMinutes}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl bg-white/5 p-3">
                <div className="text-xs" style={{ color: "var(--muted)" }}>RPE (1–10)</div>
                <div className="mt-1">
                  <input type="range" min={1} max={10} value={Number(rpe || 7)} onChange={e => setRpe(String(e.target.value))} className="w-full" />
                  <div className="mt-1 flex items-center justify-between text-xs opacity-80">
                    {[1,3,5,7,9,10].map(v => (
                      <button key={v} className="px-2 py-0.5 rounded bg-white/10" onClick={() => setRpe(String(v))}>{v}</button>
                    ))}
                    <span className="ml-2 text-xs">Selected: <strong>{rpe || 7}</strong></span>
                  </div>
                </div>
              </div>
            </div>

            {/* Overall progress */}
            <div className="rounded-xl bg-white/5 p-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Session Progress</div>
                <div className="ml-auto text-sm">{progressPct}%</div>
              </div>
              <div className="mt-2 h-2 w-full rounded bg-white/10">
                <div className="h-2 rounded" style={{ width: `${progressPct}%`, background: "var(--pine,#ef4444)" }} />
              </div>
              <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                Progress is based on sets (strength) and repeats (endurance) checked off.
              </div>
            </div>

            {/* Plan blocks */}
            <div className="pt-1">
              <div className="text-sm font-semibold">Plan</div>
              <div className="mt-2">{renderBlocks()}</div>
            </div>
          </div>
        )}
      </div>

      {/* Sticky action bar */}
      <div
        className="fixed left-0 right-0 bottom-0"
        style={{ background: "rgba(10,10,12,0.85)", borderTop: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(6px)" }}
      >
        <div className="max-w-3xl mx-auto px-3 py-3">
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            <Link className="btn" href={`/training/timer/${sessionId}`}>
              <Play className="w-4 h-4 mr-1" /> Start Timer
            </Link>

            <button className="btn btn-dark" onClick={markCompleted}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Finish (Mark Completed)
            </button>

            <button className="btn btn-dark" onClick={markSkipped}>
              <SkipForward className="w-4 h-4 mr-1" /> Skip
            </button>

            <button className="btn btn-dark" onClick={resetProgress} title="Clear local check-offs">
              <RotateCcw className="w-4 h-4 mr-1" /> Reset Progress
            </button>

            {note ? <span className="text-xs ml-auto" style={{ color: "#fca5a5" }}>{note}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
