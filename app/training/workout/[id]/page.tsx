// app/training/workout/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import * as Supa from "@/lib/supabaseClient";
import NavBar from "@/components/NavBar";
import {
  CheckCircle2,
  RotateCcw,
  Timer,
  Dumbbell,
  Activity,
  ChevronRight,
} from "lucide-react";

/* ======================= Types ======================= */
type PlanItem = {
  id: string;
  user_id: string;
  session_date: string; // yyyy-mm-dd
  title: string;
  details: any | string | null;
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
  | {
      id?: string;
      type: "endurance";
      title?: string;
      blockKind: "warmup" | "main" | "cooldown";
      intervals: EnduranceRow[];
    };

type SectionType = "endurance" | "strength";

/** Results tables (match your DB columns) */
type StrengthSetResult = {
  set_id: string;
  user_id?: string;
  plan_item_id?: string;
  actual_reps: number | null;
  actual_load_kg: number | null;
  actual_rpe: number | null;
  result_notes: string | null;
  is_completed: boolean | null;
};

type EnduranceIntervalResult = {
  interval_id: string;
  user_id?: string;
  plan_item_id?: string;
  reps_completed: number | null;
  actual_duration_sec: number | null;
  actual_distance_m: number | null;
  actual_rpe: number | null;
  result_notes: string | null;
};

/* ======================= Utils ======================= */
function parseDetails(details: any | string | null): any {
  if (!details) return {};
  if (typeof details === "string") {
    try {
      return JSON.parse(details);
    } catch {
      return {};
    }
  }
  if (typeof details === "object") return details;
  return {};
}
function fromYMD(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}
function secondsToHMS(s?: number | null) {
  const v = typeof s === "number" ? s : 0;
  if (!v || v <= 0) return "0:00";
  const h = Math.floor(v / 3600),
    m = Math.floor((v % 3600) / 60),
    sec = v % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function targetLabel(r: EnduranceRow) {
  const lo = r.target_low ?? undefined;
  const hi = r.target_high ?? undefined;
  const dash = lo != null && hi != null && lo !== hi ? `–${hi}` : "";
  switch (r.target_type) {
    case "rpe":
      return lo != null ? `RPE ${lo}${dash}` : "RPE";
    case "hr":
      return lo != null ? `${lo}${dash} bpm` : "HR";
    case "power":
      return lo != null ? `${lo}${dash} W` : "Power";
    case "pace":
      return lo != null ? `Pace ${lo}${dash}` : "Pace";
    default:
      return "";
  }
}

/* ======================= Local progress ======================= */
type Progress = {
  blocks: Record<
    string,
    {
      strength?: Record<string, { completedSets: number }>;
      intervals?: Record<string, { completedReps: number }>;
    }
  >;
};
function loadProgress(key: string): Progress {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { blocks: {} };
}
function saveProgress(key: string, p: Progress) {
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {}
}

/* ======================= Page ======================= */
export default function AthleteWorkoutPlayPage() {
  const params = useParams() as { id?: string };
  const sessionId = params?.id || "";
  const progressKey = `workoutProgress:${sessionId}`;

  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try {
      if (typeof anyS.getSupabase === "function") return anyS.getSupabase();
    } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [meId, setMeId] = useState<string | null>(null);

  const [item, setItem] = useState<PlanItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  const [progress, setProgress] = useState<Progress>({ blocks: {} });
  const builderDataRef = useRef<{ blocks: Block[]; sectionOrder?: SectionType[] } | null>(null);
  const blocks: Block[] = useMemo(
    () => builderDataRef.current?.blocks ?? [],
    [builderDataRef.current]
  );

  /* ---------- strength results state ---------- */
  const [strengthResults, setStrengthResults] = useState<
    Record<string, StrengthSetResult>
  >({});
  const strengthSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  /* ---------- endurance results state ---------- */
  const [enduranceResults, setEnduranceResults] = useState<
    Record<string, EnduranceIntervalResult>
  >({});
  const enduranceSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  /* ---------- load auth ---------- */
  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getUser();
      setMeId(data?.user?.id ?? null);
    })();
  }, [supabase]);

  /* ---------- Assemble strength + endurance ---------- */
  const loadStructuredProgram = useCallback(
    async (planId: string, details: any) => {
      if (!supabase) return;

      const parsed = parseDetails(details);
      const sectionOrderSaved = Array.isArray(parsed.sectionOrder)
        ? (parsed.sectionOrder.filter(
            (s: unknown): s is SectionType => s === "endurance" || s === "strength"
          ) as SectionType[])
        : undefined;

      // Endurance intervals
      const { data: ints } = await supabase
        .from("training_intervals")
        .select(
          "id,block,order_index,repeats,mode,duration_sec,distance_m,target_type,target_low,target_high,notes"
        )
        .eq("plan_item_id", planId);

      const list = (ints ?? []).slice().sort((a: any, b: any) => {
        const order = (blk: "warmup" | "main" | "cooldown") =>
          blk === "warmup" ? 0 : blk === "main" ? 1 : 2;
        const bo = order(a.block) - order(b.block);
        if (bo !== 0) return bo;
        return (a.order_index ?? 0) - (b.order_index ?? 0);
      }) as EnduranceRow[];

      const warmup = list.filter((r) => r.block === "warmup");
      const main = list.filter((r) => r.block === "main");
      const cool = list.filter((r) => r.block === "cooldown");

      const enduranceBlocks: Block[] = [];
      if (warmup.length)
        enduranceBlocks.push({
          type: "endurance",
          title: "Warm-up",
          blockKind: "warmup",
          intervals: warmup,
        });
      if (main.length)
        enduranceBlocks.push({
          type: "endurance",
          title: "Main Set",
          blockKind: "main",
          intervals: main,
        });
      if (cool.length)
        enduranceBlocks.push({
          type: "endurance",
          title: "Cool-down",
          blockKind: "cooldown",
          intervals: cool,
        });

      // Strength
      const { data: blocksRaw } = await supabase
        .from("strength_blocks")
        .select("id,title,order_index")
        .eq("plan_item_id", planId)
        .order("order_index", { ascending: true });

      let exByBlock: Record<string, StrengthExercise[]> = {};
      if ((blocksRaw ?? []).length > 0) {
        const blockIds = (blocksRaw ?? []).map((b: any) => b.id as string);

        const { data: exs } = await supabase
          .from("strength_exercises")
          .select("id,block_id,name,group_label,demo_url,order_index")
          .in("block_id", blockIds)
          .order("order_index", { ascending: true });

        const exIds = (exs ?? []).map((e: any) => e.id as string);

        let setsByExercise: Record<string, StrengthSet[]> = {};
        if (exIds.length) {
          const { data: setsRows } = await supabase
            .from("strength_sets")
            .select(
              "id,exercise_id,set_index,target_reps,target_percent_rm,target_rpe,target_load_kg,rest_seconds,notes"
            )
            .in("exercise_id", exIds)
            .order("set_index", { ascending: true });

          setsByExercise = (setsRows ?? []).reduce(
            (acc: Record<string, StrengthSet[]>, s: any) => {
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
            },
            {}
          );
        }

        exByBlock = (exs ?? []).reduce(
          (acc: Record<string, StrengthExercise[]>, e: any) => {
            (acc[e.block_id] ??= []).push({
              id: e.id,
              name: e.name ?? "",
              group_label: e.group_label ?? null,
              demo_url: e.demo_url ?? null,
              order_index: e.order_index ?? null,
              sets: setsByExercise[e.id] ?? [],
            });
            return acc;
          },
          {}
        );
      }

      const strengthBlocks: Block[] = (blocksRaw ?? []).map((b: any) => ({
        id: b.id,
        type: "strength" as const,
        title: b.title ?? "Strength",
        exercises: exByBlock[b.id as string] ?? [],
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
      finalOrder.forEach((sec) => {
        if (sec === "endurance" && hasEndurance) assembled.push(...enduranceBlocks);
        if (sec === "strength" && hasStrength) assembled.push(...strengthBlocks);
      });

      // Legacy fallback
      const legacyBlocks: Block[] = Array.isArray(parsed?.blocks)
        ? (parsed.blocks as any)
        : [];
      const finalBlocks = assembled.length ? assembled : legacyBlocks;

      builderDataRef.current = { blocks: finalBlocks, sectionOrder: finalOrder };
    },
    [supabase]
  );

  /* ---------- load session + existing results ---------- */
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
      await loadStructuredProgram(data.id, data.details);

      // Load progress (local)
      setProgress(loadProgress(progressKey));

      // Load results (server) if we know the user and we have sets/intervals
      const me = await supabase.auth.getUser();
      const uid = me.data?.user?.id;
      if (!uid) return;
      const allBlocks = builderDataRef.current?.blocks ?? [];
      const setIds: string[] = [];
      const intervalIds: string[] = [];
      allBlocks.forEach((b) => {
        if (b.type === "strength") {
          b.exercises.forEach((ex) => {
            (ex.sets || []).forEach((s) => {
              if (s.id) setIds.push(s.id);
            });
          });
        } else if (b.type === "endurance") {
          (b.intervals || []).forEach((row) => {
            if (row.id) intervalIds.push(row.id);
          });
        }
      });

      if (setIds.length) {
        const { data: rs } = await supabase
          .from("strength_set_results")
          .select(
            "set_id,actual_reps,actual_load_kg,actual_rpe,result_notes,is_completed"
          )
          .eq("user_id", uid)
          .eq("plan_item_id", sessionId)
          .in("set_id", setIds);
        const map: Record<string, StrengthSetResult> = {};
        (rs ?? []).forEach((r: any) => {
          map[r.set_id] = {
            set_id: r.set_id,
            actual_reps: r.actual_reps,
            actual_load_kg: r.actual_load_kg,
            actual_rpe: r.actual_rpe,
            result_notes: r.result_notes,
            is_completed: r.is_completed,
          };
        });
        setStrengthResults(map);
      }

      if (intervalIds.length) {
        const { data: irs } = await supabase
          .from("endurance_interval_results")
          .select(
            "interval_id,reps_completed,actual_duration_sec,actual_distance_m,actual_rpe,result_notes"
          )
          .eq("user_id", uid)
          .eq("plan_item_id", sessionId)
          .in("interval_id", intervalIds);
        const map: Record<string, EnduranceIntervalResult> = {};
        (irs ?? []).forEach((r: any) => {
          map[r.interval_id] = {
            interval_id: r.interval_id,
            reps_completed: r.reps_completed,
            actual_duration_sec: r.actual_duration_sec,
            actual_distance_m: r.actual_distance_m,
            actual_rpe: r.actual_rpe,
            result_notes: r.result_notes,
          };
        });
        setEnduranceResults(map);
      }
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, sessionId, loadStructuredProgram, progressKey]);

  useEffect(() => {
    loadItem();
  }, [loadItem]);

  /* ---------- save helpers (debounced upserts) ---------- */
  function scheduleStrengthSave(setId: string, payload: Omit<StrengthSetResult, "set_id">) {
    if (!supabase || !meId) return;
    if (strengthSaveTimers.current[setId]) clearTimeout(strengthSaveTimers.current[setId]!);
    strengthSaveTimers.current[setId] = setTimeout(async () => {
      try {
        await supabase
          .from("strength_set_results")
          .upsert(
            {
              user_id: meId,
              plan_item_id: sessionId,
              set_id: setId,
              ...payload,
            },
            { onConflict: "user_id,plan_item_id,set_id" }
          );
      } catch (e: any) {
        setNote(e.message ?? String(e));
      }
    }, 500);
  }

  function scheduleEnduranceSave(
    intervalId: string,
    payload: Omit<EnduranceIntervalResult, "interval_id">
  ) {
    if (!supabase || !meId) return;
    if (enduranceSaveTimers.current[intervalId]) clearTimeout(enduranceSaveTimers.current[intervalId]!);
    enduranceSaveTimers.current[intervalId] = setTimeout(async () => {
      try {
        await supabase
          .from("endurance_interval_results")
          .upsert(
            {
              user_id: meId,
              plan_item_id: sessionId,
              interval_id: intervalId,
              ...payload,
            },
            { onConflict: "user_id,plan_item_id,interval_id" }
          );
      } catch (e: any) {
        setNote(e.message ?? String(e));
      }
    }, 500);
  }

  /* ---------- local + save for strength ---------- */
  function updateStrengthResultLocal(
    setId: string,
    patch: Partial<StrengthSetResult>
  ) {
    setStrengthResults((prev) => ({
      ...prev,
      [setId]: {
        set_id: setId,
        actual_reps: prev[setId]?.actual_reps ?? null,
        actual_load_kg: prev[setId]?.actual_load_kg ?? null,
        actual_rpe: prev[setId]?.actual_rpe ?? null,
        result_notes: prev[setId]?.result_notes ?? null,
        is_completed: prev[setId]?.is_completed ?? null,
        ...patch,
      },
    }));
    const { set_id: _omit, ...payload } = {
      ...strengthResults[setId],
      ...patch,
    } as StrengthSetResult;
    scheduleStrengthSave(setId, payload);
  }

  /* ---------- local + save for endurance ---------- */
  function updateEnduranceResultLocal(
    intervalId: string,
    patch: Partial<EnduranceIntervalResult>
  ) {
    setEnduranceResults((prev) => ({
      ...prev,
      [intervalId]: {
        interval_id: intervalId,
        reps_completed: prev[intervalId]?.reps_completed ?? null,
        actual_duration_sec: prev[intervalId]?.actual_duration_sec ?? null,
        actual_distance_m: prev[intervalId]?.actual_distance_m ?? null,
        actual_rpe: prev[intervalId]?.actual_rpe ?? null,
        result_notes: prev[intervalId]?.result_notes ?? null,
        ...patch,
      },
    }));
    const { interval_id: _omit, ...payload } = {
      ...enduranceResults[intervalId],
      ...patch,
    } as EnduranceIntervalResult;
    scheduleEnduranceSave(intervalId, payload);
  }

  /* ---------- Progress helpers ---------- */
  function updateStrengthProgress(
    bi: number,
    exi: number,
    setsPlanned = 0,
    delta = 1
  ) {
    setProgress((prev) => {
      const p = JSON.parse(JSON.stringify(prev)) as Progress;
      const bkey = String(bi),
        ekey = String(exi);
      p.blocks[bkey] ??= {};
      p.blocks[bkey].strength ??= {};
      const cur = p.blocks[bkey].strength![ekey]?.completedSets ?? 0;
      const next = clamp(cur + delta, 0, setsPlanned);
      p.blocks[bkey].strength![ekey] = { completedSets: next };
      saveProgress(progressKey, p);
      return p;
    });
  }
  function updateIntervalProgress(
    bi: number,
    ii: number,
    repsPlanned = 0,
    delta = 1
  ) {
    setProgress((prev) => {
      const p = JSON.parse(JSON.stringify(prev)) as Progress;
      const bkey = String(bi),
        ikey = String(ii);
      p.blocks[bkey] ??= {};
      p.blocks[bkey].intervals ??= {};
      const cur = p.blocks[bkey].intervals![ikey]?.completedReps ?? 0;
      const next = clamp(cur + delta, 0, repsPlanned);
      p.blocks[bkey].intervals![ikey] = { completedReps: next };
      saveProgress(progressKey, p);
      return p;
    });
  }
  function resetProgress() {
    const empty: Progress = { blocks: {} };
    setProgress(empty);
    saveProgress(progressKey, empty);
  }

  /* ---------- Renderers ---------- */
  function StrengthPlay({ b, bi }: { b: Extract<Block, { type: "strength" }>; bi: number }) {
    const exs = b.exercises ?? [];
    return (
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="flex items-center gap-2">
          <Dumbbell className="w-4 h-4 opacity-80" />
          <div className="font-semibold">{b.title || "Strength"}</div>
          <div className="ml-auto text-xs opacity-70">{exs.length} exercises</div>
        </div>

        <div className="mt-3 space-y-3">
          {exs.map((ex, exi) => {
            const setsPlanned = ex.sets?.length ?? 0;
            const done = progress.blocks[String(bi)]?.strength?.[String(exi)]?.completedSets ?? 0;
            return (
              <div key={ex.id || exi} className="rounded-xl bg-white/5 p-3">
                {/* exercise header */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-medium">
                    {(ex.group_label ? ex.group_label + " " : "") + (ex.name || "Exercise")}
                  </div>
                  {ex.demo_url ? (
                    <a
                      href={ex.demo_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs underline opacity-80"
                    >
                      demo
                    </a>
                  ) : null}
                  <div className="ml-auto text-xs opacity-70">
                    {done}/{setsPlanned} sets
                  </div>
                </div>

                {/* set check chips */}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {Array.from({ length: setsPlanned }, (_, i) => i).map((i) => {
                    const on = i < done;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (i === done - 1) updateStrengthProgress(bi, exi, setsPlanned, -1);
                          else if (i === done) updateStrengthProgress(bi, exi, setsPlanned, +1);
                          else
                            updateStrengthProgress(
                              bi,
                              exi,
                              setsPlanned,
                              i < done ? -(done - i) : i + 1 - done
                            );
                        }}
                        className="px-3 py-1 rounded-full text-xs"
                        style={{
                          background: on
                            ? "rgba(16,185,129,0.18)"
                            : "rgba(255,255,255,0.10)",
                        }}
                        aria-pressed={on}
                      >
                        Set {i + 1}
                      </button>
                    );
                  })}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      className="btn btn-dark"
                      onClick={() => updateStrengthProgress(bi, exi, setsPlanned, -1)}
                    >
                      -
                    </button>
                    <button
                      className="btn"
                      onClick={() => updateStrengthProgress(bi, exi, setsPlanned, +1)}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* set logging table */}
                {setsPlanned > 0 ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="opacity-70">
                          <th className="text-left">Set</th>
                          <th className="text-left">Planned</th>
                          <th className="text-left">Actual Reps</th>
                          <th className="text-left">Actual Load (kg)</th>
                          <th className="text-left">Actual RPE</th>
                          <th className="text-left">Notes</th>
                          <th className="text-left">Done</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ex.sets
                          .slice()
                          .sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0))
                          .map((s, i) => {
                            const sid = s.id;
                            const res = sid ? strengthResults[sid] : undefined;
                            return (
                              <tr key={sid || i}>
                                <td className="py-1 pr-2">#{s.set_index ?? i + 1}</td>
                                <td className="py-1 pr-2 opacity-80">
                                  {(s.target_reps != null ? `${s.target_reps} reps` : "—") +
                                    (s.target_percent_rm != null ? ` · ${s.target_percent_rm}%RM` : "") +
                                    (s.target_rpe != null ? ` · RPE ${s.target_rpe}` : "") +
                                    (s.target_load_kg != null ? ` · ${s.target_load_kg}kg` : "")}
                                </td>
                                <td className="py-1 pr-2">
                                  <input
                                    type="number"
                                    className="w-20 field"
                                    value={res?.actual_reps ?? ""}
                                    onChange={(e) =>
                                      sid &&
                                      updateStrengthResultLocal(sid, {
                                        actual_reps:
                                          e.target.value === "" ? null : Number(e.target.value),
                                      })
                                    }
                                  />
                                </td>
                                <td className="py-1 pr-2">
                                  <input
                                    type="number"
                                    className="w-24 field"
                                    value={res?.actual_load_kg ?? ""}
                                    onChange={(e) =>
                                      sid &&
                                      updateStrengthResultLocal(sid, {
                                        actual_load_kg:
                                          e.target.value === "" ? null : Number(e.target.value),
                                      })
                                    }
                                  />
                                </td>
                                <td className="py-1 pr-2">
                                  <input
                                    type="number"
                                    className="w-20 field"
                                    value={res?.actual_rpe ?? ""}
                                    onChange={(e) =>
                                      sid &&
                                      updateStrengthResultLocal(sid, {
                                        actual_rpe:
                                          e.target.value === "" ? null : Number(e.target.value),
                                      })
                                    }
                                  />
                                </td>
                                <td className="py-1 pr-2">
                                  <input
                                    className="w-48 field"
                                    value={res?.result_notes ?? ""}
                                    onChange={(e) =>
                                      sid &&
                                      updateStrengthResultLocal(sid, {
                                        result_notes: e.target.value,
                                      })
                                    }
                                  />
                                </td>
                                <td className="py-1 pr-2">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(res?.is_completed)}
                                    onChange={(e) =>
                                      sid &&
                                      updateStrengthResultLocal(sid, {
                                        is_completed: e.target.checked,
                                      })
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
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

  function EndurancePlay({
    b,
    bi,
  }: {
    b: Extract<Block, { type: "endurance" }>;
    bi: number;
  }) {
    const rows = b.intervals ?? [];
    const label =
      b.title ||
      (b.blockKind === "warmup" ? "Warm-up" : b.blockKind === "main" ? "Main Set" : "Cool-down");
    return (
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 opacity-80" />
          <div className="font-semibold">{label}</div>
          <div className="ml-auto text-xs opacity-70">{rows.length} rows</div>
        </div>

        <div className="mt-3 space-y-3">
          {rows.map((row, ii) => {
            const reps = Number(row.repeats ?? 0) || 0;
            const done =
              progress.blocks[String(bi)]?.intervals?.[String(ii)]?.completedReps ?? 0;

            const mainText =
              row.mode === "duration"
                ? `${reps}× ${secondsToHMS(row.duration_sec)}`
                : `${reps}× ${(Number(row.distance_m ?? 0) / 1000).toFixed(2)} km`;

            const rid = row.id as string | undefined;
            const r = rid ? enduranceResults[rid] : undefined;

            return (
              <div key={row.id || ii} className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-medium">{mainText}</div>
                  <div className="text-xs opacity-80"> @ {targetLabel(row)}</div>
                  <div className="ml-auto">
                    <Link
                      className="btn btn-dark text-xs"
                      href={`/training/timer/${sessionId}?block=${bi}&interval=${ii}`}
                    >
                      <Timer className="w-3 h-3 mr-1" /> Timer
                    </Link>
                  </div>
                </div>

                {/* repeat check chips */}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {Array.from({ length: reps }, (_, i) => i).map((i) => {
                    const on = i < done;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (i === done - 1) updateIntervalProgress(bi, ii, reps, -1);
                          else if (i === done) updateIntervalProgress(bi, ii, reps, +1);
                          else
                            updateIntervalProgress(
                              bi,
                              ii,
                              reps,
                              i < done ? -(done - i) : i + 1 - done
                            );
                        }}
                        className="px-3 py-1 rounded-full text-xs"
                        style={{
                          background: on
                            ? "rgba(16,185,129,0.18)"
                            : "rgba(255,255,255,0.10)",
                        }}
                        aria-pressed={on}
                      >
                        Rep {i + 1}
                      </button>
                    );
                  })}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      className="btn btn-dark"
                      onClick={() => updateIntervalProgress(bi, ii, reps, -1)}
                    >
                      -
                    </button>
                    <button
                      className="btn"
                      onClick={() => updateIntervalProgress(bi, ii, reps, +1)}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* logging for endurance actuals */}
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {row.mode === "duration" ? (
                    <div className="space-y-1">
                      <div className="text-xs opacity-70">Actual Duration (sec)</div>
                      <input
                        type="number"
                        className="w-full field"
                        value={r?.actual_duration_sec ?? ""}
                        onChange={(e) =>
                          rid &&
                          updateEnduranceResultLocal(rid, {
                            actual_duration_sec:
                              e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="text-xs opacity-70">Actual Distance (m)</div>
                      <input
                        type="number"
                        className="w-full field"
                        value={r?.actual_distance_m ?? ""}
                        onChange={(e) =>
                          rid &&
                          updateEnduranceResultLocal(rid, {
                            actual_distance_m:
                              e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="text-xs opacity-70">Actual RPE</div>
                    <input
                      type="number"
                      className="w-full field"
                      value={r?.actual_rpe ?? ""}
                      onChange={(e) =>
                        rid &&
                        updateEnduranceResultLocal(rid, {
                          actual_rpe: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>

                  <div className="md:col-span-2 space-y-1">
                    <div className="text-xs opacity-70">Notes</div>
                    <input
                      className="w-full field"
                      value={r?.result_notes ?? ""}
                      onChange={(e) =>
                        rid &&
                        updateEnduranceResultLocal(rid, {
                          result_notes: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>

                {row.notes ? <div className="mt-2 text-xs opacity-80">{row.notes}</div> : null}

                <Link
                  className="mt-2 inline-flex items-center gap-1 text-xs underline opacity-90"
                  href={`/training/timer/${sessionId}?block=${bi}&interval=${ii}`}
                >
                  Open Timer <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ---------- Page UI ---------- */
  return (
    <div className="max-w-3xl mx-auto pb-28">
      <NavBar />

      <div
        className="mt-4 rounded-2xl p-4 md:p-5"
        style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}
      >
        <div className="flex items-start gap-2 flex-wrap">
          <Link href={`/training/session/${sessionId}`} className="btn">
            ← Overview
          </Link>
          <div className="ml-auto text-sm opacity-70">
            {item?.session_date ? fromYMD(item.session_date).toLocaleDateString() : ""}
          </div>
        </div>

        {loading ? (
          <div className="mt-3">Loading workout…</div>
        ) : !item ? (
          <div className="mt-3 text-sm" style={{ color: "#fca5a5" }}>
            {note || "Workout not found."}
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold">{item.title}</h1>
              <span className="text-xs px-2 py-[2px] rounded bg-white/10">{item.status}</span>
            </div>

            {/* Blocks (in saved section order) */}
            <div className="space-y-4">
              {blocks.map((b, i) =>
                b.type === "strength" ? (
                  <StrengthPlay key={b.id ?? `s-${i}`} b={b} bi={i} />
                ) : (
                  <EndurancePlay key={b.id ?? `e-${i}`} b={b} bi={i} />
                )
              )}
            </div>

            <div className="pt-2">
              <button className="btn btn-dark" onClick={resetProgress}>
                <RotateCcw className="w-4 h-4 mr-1" /> Reset Progress
              </button>
              {note ? (
                <span className="text-xs ml-3" style={{ color: "#fca5a5" }}>
                  {note}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
