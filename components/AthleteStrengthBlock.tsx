// components/AthleteStrengthBlock.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import * as Supa from "@/lib/supabaseClient";
import { Dumbbell, CheckCircle2 } from "lucide-react";

/* ---------------- Types ---------------- */
type Block = {
  id: string;
  title: string | null;
  order_index: number | null;
};

type Exercise = {
  id: string;
  block_id: string;
  name: string | null;
  group_label: string | null;
  demo_url: string | null;
  order_index: number | null;
};

type SetRow = {
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
  notes: string | null;            // <-- NOTE: column name is 'notes'
  completed_at: string | null;
  created_at?: string;
  updated_at?: string;
};

type Props = {
  planItemId: string;
  userId: string; // pass the athlete's id (you already do: userId={item.user_id})
};

/* ---------------- Component ---------------- */
export default function AthleteStrengthBlock({ planItemId, userId }: Props) {
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
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [sets, setSets] = useState<SetRow[]>([]);
  const [resultsBySetId, setResultsBySetId] = useState<Record<string, SetResult>>({});

  /* --------- Load data --------- */
  const loadAll = useCallback(async () => {
    if (!isConfigured || !supabase || !planItemId) return;
    setLoading(true);
    setNote("");
    try {
      // Blocks
      const b = await supabase
        .from("strength_blocks")
        .select("id,title,order_index")
        .eq("plan_item_id", planItemId)
        .order("order_index", { ascending: true });
      if (b.error) throw b.error;
      const blockRows = (b.data ?? []) as Block[];

      // Exercises
      const blockIds = blockRows.map((r) => r.id);
      let exRows: Exercise[] = [];
      if (blockIds.length) {
        const e = await supabase
          .from("strength_exercises")
          .select("id,block_id,name,group_label,demo_url,order_index")
          .in("block_id", blockIds)
          .order("order_index", { ascending: true });
        if (e.error) throw e.error;
        exRows = (e.data ?? []) as Exercise[];
      }

      // Sets
      const exIds = exRows.map((r) => r.id);
      let sRows: SetRow[] = [];
      if (exIds.length) {
        const s = await supabase
          .from("strength_sets")
          .select("id,exercise_id,set_index,target_reps,target_percent_rm,target_rpe,target_load_kg,rest_seconds,notes")
          .in("exercise_id", exIds)
          .order("set_index", { ascending: true });
        if (s.error) throw s.error;
        sRows = (s.data ?? []) as SetRow[];
      }

      // Existing results for this plan item (should be only this athlete's plan)
      const r = await supabase
        .from("strength_set_results")
        .select("*")
        .eq("plan_item_id", planItemId);
      if (r.error) throw r.error;
      const rRows = (r.data ?? []) as SetResult[];

      // Index results by set_id
      const map: Record<string, SetResult> = {};
      for (const row of rRows) {
        if (row.set_id) map[row.set_id] = row;
      }

      setBlocks(blockRows);
      setExercises(exRows);
      setSets(sRows);
      setResultsBySetId(map);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, planItemId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  /* --------- Helpers --------- */
  const getBlockExercises = (blockId: string) =>
    exercises.filter(e => e.block_id === blockId).sort((a,b)=> (a.order_index ?? 0) - (b.order_index ?? 0));

  const getExerciseSets = (exerciseId: string) =>
    sets.filter(s => s.exercise_id === exerciseId).sort((a,b)=> (a.set_index ?? 0) - (b.set_index ?? 0));

  function displayName(ex: Exercise) {
    return `${ex.group_label ? ex.group_label + " " : ""}${ex.name ?? "Exercise"}`;
    }

  function isCompleted(setId: string) {
    const r = resultsBySetId[setId];
    return Boolean(r?.completed_at);
  }

  /* --------- Upsert result --------- */
  async function upsertResult(setRow: SetRow, patch: Partial<SetResult>) {
    if (!isConfigured || !supabase) return;
    const existing = resultsBySetId[setRow.id];

    // Build base row for upsert
    const payload: SetResult = {
      id: existing?.id, // optional
      plan_item_id: planItemId,
      set_id: setRow.id,
      exercise_id: setRow.exercise_id ?? null,
      user_id: userId ?? null,              // <— use prop, not a bare variable
      set_index: setRow.set_index ?? null,
      performed_reps: existing?.performed_reps ?? null,
      performed_load_kg: existing?.performed_load_kg ?? null,
      performed_rpe: existing?.performed_rpe ?? null,
      performed_percent_rm: existing?.performed_percent_rm ?? null,
      rest_seconds: existing?.rest_seconds ?? null,
      notes: existing?.notes ?? null,
      completed_at: existing?.completed_at ?? null,
      ...patch, // apply deltas (e.g., performed_reps, notes, completed_at)
    };

    const { data, error } = await supabase
      .from("strength_set_results")
      .upsert(payload, { onConflict: "plan_item_id,set_id" })
      .select("*")
      .single();

    if (error) {
      setNote(error.message ?? String(error));
      return;
    }
    // Optimistic local update
    setResultsBySetId(prev => ({ ...prev, [setRow.id]: data as SetResult }));
  }

  /* --------- UI handlers --------- */
  function toggleCompleted(setRow: SetRow) {
    const r = resultsBySetId[setRow.id];
    const next = r?.completed_at ? null : new Date().toISOString();
    void upsertResult(setRow, { completed_at: next });
  }

  function updateNum<T extends keyof SetResult>(setRow: SetRow, key: T, input: string) {
    const v = input.trim();
    const num = v === "" ? null : Number(v);
    if (Number.isNaN(num)) return; // ignore bad input
    void upsertResult(setRow, { [key]: num } as any);
  }

  function updateNotes(setRow: SetRow, text: string) {
    void upsertResult(setRow, { notes: text }); // <-- notes, not result_notes
  }

  /* --------- Render --------- */
  if (loading) {
    return (
      <div className="rounded-xl bg-white/5 p-3">
        <div className="flex items-center gap-2">
          <div className="rounded-full p-2 bg-white/10"><Dumbbell className="w-5 h-5 text-emerald-300" /></div>
          <div>
            <div className="text-sm" style={{ color: "var(--muted)" }}>Strength</div>
            <div className="text-lg font-semibold">Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  if (note) {
    return (
      <div className="rounded-xl bg-white/5 p-3">
        <div className="text-sm" style={{ color: "#fca5a5" }}>{note}</div>
      </div>
    );
  }

  // Nice compact, editable view
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <div className="flex items-center gap-2">
        <div className="rounded-full p-2 bg-white/10"><Dumbbell className="w-5 h-5 text-emerald-300" /></div>
        <div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>Strength — Log your sets</div>
          <div className="text-lg font-semibold">
            {exercises.length} exercises • {sets.length} sets
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-4">
        {blocks.map((b) => (
          <div key={b.id} className="rounded-lg border border-white/10 p-3">
            <div className="font-semibold">{b.title || "Strength Block"}</div>

            {getBlockExercises(b.id).length === 0 ? (
              <div className="mt-2 text-sm opacity-70">No exercises in this block.</div>
            ) : (
              getBlockExercises(b.id).map(ex => (
                <div key={ex.id} className="mt-3 rounded bg-white/5 p-2">
                  <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                    <div className="font-medium">{displayName(ex)}</div>
                    {ex.demo_url ? (
                      <a href={ex.demo_url} target="_blank" rel="noreferrer" className="text-xs underline opacity-80">demo</a>
                    ) : null}
                    <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
                      {getExerciseSets(ex.id).length} set{getExerciseSets(ex.id).length === 1 ? "" : "s"}
                    </div>
                  </div>

                  {/* Sets table */}
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ color: "var(--muted)" }}>
                          <th className="text-left">Set</th>
                          <th className="text-left">Target</th>
                          <th className="text-left">Performed</th>
                          <th className="text-left">Notes</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {getExerciseSets(ex.id).map(s => {
                          const r = resultsBySetId[s.id];
                          const done = Boolean(r?.completed_at);
                          const targetParts: string[] = [];
                          if (s.target_reps != null) targetParts.push(`${s.target_reps} reps`);
                          if (s.target_percent_rm != null) targetParts.push(`${s.target_percent_rm}%RM`);
                          if (s.target_rpe != null) targetParts.push(`RPE ${s.target_rpe}`);
                          if (s.target_load_kg != null) targetParts.push(`${s.target_load_kg}kg`);
                          if (s.rest_seconds != null) targetParts.push(`rest ${s.rest_seconds}s`);

                          return (
                            <tr key={s.id} className="align-top">
                              <td className="py-1 pr-2">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    className="px-2 py-1 rounded-full"
                                    style={{ background: done ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.08)" }}
                                    onClick={() => toggleCompleted(s)}
                                    title={done ? "Uncheck" : "Mark complete"}
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                  <span className="opacity-80">Set {s.set_index ?? ""}</span>
                                </div>
                              </td>

                              <td className="py-1 pr-2">
                                <div className="opacity-80">{targetParts.join(" · ") || "—"}</div>
                              </td>

                              <td className="py-1 pr-2">
                                <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(60px,100px))", gap: 6 }}>
                                  <input
                                    className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                    placeholder="reps"
                                    inputMode="numeric"
                                    value={r?.performed_reps ?? ""}
                                    onChange={(e) => updateNum(s, "performed_reps", e.target.value)}
                                  />
                                  <input
                                    className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                    placeholder="kg"
                                    inputMode="decimal"
                                    value={r?.performed_load_kg ?? ""}
                                    onChange={(e) => updateNum(s, "performed_load_kg", e.target.value)}
                                  />
                                  <input
                                    className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                    placeholder="RPE"
                                    inputMode="decimal"
                                    value={r?.performed_rpe ?? ""}
                                    onChange={(e) => updateNum(s, "performed_rpe", e.target.value)}
                                  />
                                  <input
                                    className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                    placeholder="%RM"
                                    inputMode="decimal"
                                    value={r?.performed_percent_rm ?? ""}
                                    onChange={(e) => updateNum(s, "performed_percent_rm", e.target.value)}
                                  />
                                </div>
                              </td>

                              <td className="py-1 pr-2" style={{ minWidth: 160 }}>
                                <textarea
                                  className="w-full px-2 py-1 rounded bg-white/5 border border-white/10"
                                  rows={1}
                                  placeholder="Notes"
                                  value={r?.notes ?? ""}          // <-- use 'notes'
                                  onChange={(e) => updateNotes(s, e.target.value)}
                                />
                              </td>

                              <td className="py-1 text-right">
                                <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                                  {done ? "Completed" : "Tap to complete"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
        Tip: tap the check icon to mark a set complete; fill any performed values to log exactly what you did.
      </div>
    </div>
  );
}
