"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as Supa from "@/lib/supabaseClient";
import ProgramBuilder from "@/components/ProgramBuilder";
import { ChevronLeft, Eye, Loader2, Rocket, Dumbbell, Timer } from "lucide-react";

/** ---------- Types (match your tables) ---------- */
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

type Interval = {
  id: string;
  plan_item_id: string;
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

/** ---------- Helpers ---------- */
function secondsToHMS(s: number | null | undefined) {
  const v = typeof s === "number" ? s : 0;
  if (!v || v <= 0) return "0:00";
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function estEnduranceMinutes(intervals: Interval[]) {
  let sec = 0;
  for (const r of intervals) {
    const reps = r.repeats ?? 1;
    const dur = r.mode === "duration" ? (r.duration_sec ?? 0) : 0;
    sec += reps * dur;
  }
  return Math.round(sec / 60);
}

/** ---------- Component ---------- */
export default function CoachSessionV2({
  athleteId,
  planItemId,
}: {
  athleteId: string;
  planItemId: string;
}) {
  // supabase client (works with your helper)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  // Live preview data (strength + endurance)
  const [strengthBlocks, setStrengthBlocks] = useState<StrengthBlock[]>([]);
  const [intervals, setIntervals] = useState<Interval[]>([]);

  /** Load a condensed view of the session from the DB (read-only preview). */
  const loadPreview = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    setLoading(true);
    setNote("");
    try {
      // Strength blocks
      const b = await supabase
        .from("strength_blocks")
        .select("id,title,order_index")
        .eq("plan_item_id", planItemId)
        .order("order_index", { ascending: true });

      if (b.error) throw b.error;
      const blocks = (b.data ?? []) as { id: string; title: string | null; order_index: number | null }[];

      // Exercises
      const blockIds = blocks.map((x) => x.id);
      let exercises: StrengthExercise[] = [];
      if (blockIds.length) {
        const e = await supabase
          .from("strength_exercises")
          .select("id,block_id,name,group_label,demo_url,order_index")
          .in("block_id", blockIds)
          .order("order_index", { ascending: true });
        if (e.error) throw e.error;
        exercises = (e.data ?? []).map((r: any) => ({ ...r, sets: [] })) as StrengthExercise[];
      }

      // Sets
      const exIds = exercises.map((x) => x.id);
      let sets: StrengthSet[] = [];
      if (exIds.length) {
        const s = await supabase
          .from("strength_sets")
          .select("id,exercise_id,set_index,target_reps,target_percent_rm,target_rpe,target_load_kg,rest_seconds,notes")
          .in("exercise_id", exIds)
          .order("set_index", { ascending: true });
        if (s.error) throw s.error;
        sets = (s.data ?? []) as StrengthSet[];
      }

      // Stitch sets into exercises
      const setsByEx = sets.reduce<Record<string, StrengthSet[]>>((acc, row) => {
        (acc[row.exercise_id] ??= []).push(row);
        return acc;
      }, {});
      const exByBlock = exercises.reduce<Record<string, StrengthExercise[]>>((acc, ex) => {
        ex.sets = (setsByEx[ex.id] ?? []).sort(
          (a, b) => (a.set_index ?? 0) - (b.set_index ?? 0)
        );
        (acc[ex.block_id] ??= []).push(ex);
        return acc;
      }, {});

      const sb: StrengthBlock[] = blocks.map((b) => ({
        id: b.id,
        title: b.title,
        order_index: b.order_index,
        exercises: (exByBlock[b.id] ?? []).sort(
          (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)
        ),
      }));

      // Endurance intervals (one table, we’ll group visually)
      const ints = await supabase
        .from("training_intervals")
        .select("*")
        .eq("plan_item_id", planItemId)
        .order("block", { ascending: true })
        .order("order_index", { ascending: true });
      if (ints.error) throw ints.error;

      setStrengthBlocks(sb);
      setIntervals((ints.data ?? []) as Interval[]);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, planItemId]);

  // Load initially
  useEffect(() => { loadPreview(); }, [loadPreview]);

  // Realtime auto-refresh when coach edits with ProgramBuilder
  useEffect(() => {
    if (!isConfigured || !supabase) return;
    const ch = supabase
      .channel(`coach-session-v2-${planItemId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "strength_blocks", filter: `plan_item_id=eq.${planItemId}` }, loadPreview)
      .on("postgres_changes", { event: "*", schema: "public", table: "strength_exercises" }, loadPreview)
      .on("postgres_changes", { event: "*", schema: "public", table: "strength_sets" }, loadPreview)
      .on("postgres_changes", { event: "*", schema: "public", table: "training_intervals", filter: `plan_item_id=eq.${planItemId}` }, loadPreview)
      .subscribe();
    return () => { try { supabase.removeChannel(ch); ch?.unsubscribe?.(); } catch {} };
  }, [isConfigured, supabase, planItemId, loadPreview]);

  /** Quick computed numbers for the Preview card */
  const totals = useMemo(() => {
    const blocks = strengthBlocks.length;
    const exercises = strengthBlocks.reduce((a, b) => a + b.exercises.length, 0);
    const sets = strengthBlocks.reduce((a, b) => a + b.exercises.reduce((x, e) => x + e.sets.length, 0), 0);

    const warm = intervals.filter((r) => r.block === "warmup");
    const main = intervals.filter((r) => r.block === "main");
    const cool = intervals.filter((r) => r.block === "cooldown");
    const enduMin = estEnduranceMinutes(intervals);

    return {
      strength: { blocks, exercises, sets },
      endurance: {
        rows: intervals.length,
        warm: warm.length,
        main: main.length,
        cool: cool.length,
        estMin: enduMin,
      },
    };
  }, [strengthBlocks, intervals]);

  return (
    <div className="max-w-6xl mx-auto pb-20">
      {/* Sticky shell header */}
      <div
        className="p-3 md:p-4 rounded-2xl"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "rgba(9,11,15,0.72)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <Link href={`/coach-console/${athleteId}`} className="btn btn-dark">
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back to week
          </Link>
          <div className="font-semibold ml-1">Session Composer — V2</div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href={`/coach-console/${athleteId}/session/${planItemId}`}
              className="btn btn-dark"
              title="Open original editor"
            >
              Legacy
            </Link>
            <button
              className="btn"
              onClick={loadPreview}
              title="Refresh preview"
              aria-label="Refresh preview"
            >
              <Eye className="w-4 h-4 mr-1" />
              Preview
            </button>
            <Link
              href={`/training/session/${planItemId}`}
              className="btn"
              title="View as athlete (overview)"
            >
              <Rocket className="w-4 h-4 mr-1" />
              View Session
            </Link>
          </div>
        </div>
        {note ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div> : null}
      </div>

      {/* Main 2-column layout */}
      <div className="grid md:grid-cols-[1fr,340px] gap-4 mt-4">
        {/* Left: your existing authoring UI (auto-saves) */}
        <div className="space-y-4">
          <ProgramBuilder athleteId={athleteId} planItemId={planItemId} />
        </div>

        {/* Right: live preview / sanity check */}
        <aside className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-full p-2 bg-white/10">
                <Dumbbell className="w-5 h-5 text-emerald-300" />
              </div>
              <div className="font-semibold">Strength Preview</div>
              <div className="ml-auto text-xs opacity-70">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded bg-white/5 p-2">
                <div className="opacity-70">Blocks</div>
                <div className="text-base font-semibold">{totals.strength.blocks}</div>
              </div>
              <div className="rounded bg-white/5 p-2">
                <div className="opacity-70">Exercises</div>
                <div className="text-base font-semibold">{totals.strength.exercises}</div>
              </div>
              <div className="rounded bg-white/5 p-2">
                <div className="opacity-70">Sets</div>
                <div className="text-base font-semibold">{totals.strength.sets}</div>
              </div>
            </div>

            {/* Condensed list */}
            {strengthBlocks.length ? (
              <div className="mt-3 space-y-2">
                {strengthBlocks.map((b) => (
                  <div key={b.id} className="rounded bg-white/5 p-2">
                    <div className="text-sm font-medium">{b.title || "Strength"}</div>
                    <div className="mt-1 text-xs opacity-80 space-y-1">
                      {b.exercises.map((ex) => {
                        const sets = ex.sets ?? [];
                        const reps = sets.map((s) => s.target_reps).filter(Boolean) as number[];
                        const repsLabel =
                          reps.length && reps.every((r) => r === reps[0]) ? `${reps[0]} reps` :
                          reps.length ? "varied reps" : "—";
                        const rpeVals = sets.map((s) => s.target_rpe).filter(Boolean) as number[];
                        const rpeLabel = rpeVals.length
                          ? (Math.min(...rpeVals) === Math.max(...rpeVals) ? `RPE ${rpeVals[0]}` : `RPE ${Math.min(...rpeVals)}–${Math.max(...rpeVals)}`)
                          : "";
                        return (
                          <div key={ex.id}>
                            {(ex.group_label ? ex.group_label + " " : "")}{ex.name || "Exercise"} — {sets.length} set{sets.length === 1 ? "" : "s"} ({repsLabel}{rpeLabel ? ` • ${rpeLabel}` : ""})
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-sm opacity-70">No strength blocks yet.</div>
            )}
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-full p-2 bg-white/10">
                <Timer className="w-5 h-5 text-emerald-300" />
              </div>
              <div className="font-semibold">Endurance Preview</div>
              <div className="ml-auto text-xs opacity-70">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
              <div className="rounded bg-white/5 p-2">
                <div className="opacity-70">Rows</div>
                <div className="text-base font-semibold">{totals.endurance.rows}</div>
              </div>
              <div className="rounded bg-white/5 p-2">
                <div className="opacity-70">Warm</div>
                <div className="text-base font-semibold">{totals.endurance.warm}</div>
              </div>
              <div className="rounded bg-white/5 p-2">
                <div className="opacity-70">Main</div>
                <div className="text-base font-semibold">{totals.endurance.main}</div>
              </div>
              <div className="rounded bg-white/5 p-2">
                <div className="opacity-70">Cool</div>
                <div className="text-base font-semibold">{totals.endurance.cool}</div>
              </div>
            </div>

            {/* Condensed list grouped by block */}
            {intervals.length ? (
              <div className="mt-3 space-y-3 text-xs">
                {(["warmup", "main", "cooldown"] as const).map((blk) => {
                  const rows = intervals.filter((r) => r.block === blk);
                  if (!rows.length) return null;
                  const label = blk === "warmup" ? "Warm-up" : blk === "main" ? "Main Set" : "Cool-down";
                  const estMin = estEnduranceMinutes(rows);
                  return (
                    <div key={blk} className="rounded bg-white/5 p-2">
                      <div className="font-medium">{label} · ~{estMin} min</div>
                      <div className="mt-1 space-y-1 opacity-80">
                        {rows.map((r, i) => (
                          <div key={r.id}>
                            {r.repeats}× {r.mode === "duration" ? secondsToHMS(r.duration_sec) : `${(Number(r.distance_m ?? 0) / 1000).toFixed(2)} km`} — {r.target_type.toUpperCase()} {r.target_low ?? "—"}{r.target_high ? `–${r.target_high}` : ""}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="text-[11px] opacity-70">Estimated time ignores distance-only rows.</div>
              </div>
            ) : (
              <div className="mt-3 text-sm opacity-70">No endurance intervals yet.</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
