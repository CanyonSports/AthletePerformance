// components/StrengthEditor.tsx
"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import * as Supa from "@/lib/supabaseClient";
import ColumnsToggle from "@/components/Coach/ColumnsToggle";

/** ───────────────────────── Types ───────────────────────── */
type Block = {
  id: string;
  plan_item_id: string;
  title: string;
  notes: string | null;
  order_index: number;
};
type Exercise = {
  id: string;
  block_id: string;
  name: string;
  demo_url: string | null;
  group_label: string | null; // e.g., A1, A2
  order_index: number;
};
type SetRow = {
  id: string;
  exercise_id: string;
  set_index: number;
  target_reps: number | null;
  target_load_kg: number | null;
  target_rpe: number | null;
  target_percent_rm: number | null;
  rest_seconds: number | null;
  notes: string | null;
};

type Props = { planItemId: string; athleteId: string };

/** ───────────────────────── Component ───────────────────────── */
export default function StrengthEditor({ planItemId }: Props) {
  // Keep your existing Supabase getter pattern
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  

  /** Data state (authoritative for the UI) */
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [sets, setSets] = useState<SetRow[]>([]);
  const [status, setStatus] = useState("");

  /** Draft state for text fields to avoid flicker while typing */
  type BlockDraft = { title?: string; notesStr?: string };
  type ExDraft = { name?: string; group_label?: string; demo_url?: string };
  type SetDraft = { notesStr?: string };
  const [blockDrafts, setBlockDrafts] = useState<Record<string, BlockDraft>>({});
  const [exDrafts, setExDrafts] = useState<Record<string, ExDraft>>({});
  const [setDrafts, setSetDrafts] = useState<Record<string, SetDraft>>({});

  /** Debounced patch queues (optimistic UI + delayed writes) */
  const pendingBlock = useRef<Record<string, Partial<Block>>>({});
  const pendingExercise = useRef<Record<string, Partial<Exercise>>>({});
  const pendingSet = useRef<Record<string, Partial<SetRow>>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Per-row timers for notes autosave (so multiple editors can run independently) */
  const blockNoteTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const setNoteTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const [savingNotes, setSavingNotes] = useState<Record<string, boolean>>({});

  /** ───────────────────────── Loaders ───────────────────────── */
  const loadAll = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    setStatus("Loading strength plan…");

    try {
      // Load blocks
      const b = await supabase
        .from("strength_blocks")
        .select("*")
        .eq("plan_item_id", planItemId)
        .order("order_index", { ascending: true });

      const blockIds = (b.data ?? []).map((r: any) => r.id);

      // Load exercises for those blocks
      const e = blockIds.length
        ? await supabase
            .from("strength_exercises")
            .select("*")
            .in("block_id", blockIds)
            .order("order_index", { ascending: true })
        : { data: [] as any[] };

      const exIds = (e.data ?? []).map((r: any) => r.id);

      // Load sets for those exercises
      const s = exIds.length
        ? await supabase
            .from("strength_sets")
            .select("*")
            .in("exercise_id", exIds)
            .order("set_index", { ascending: true })
        : { data: [] as any[] };

      setBlocks((b.data as Block[]) || []);
      setExercises((e.data as Exercise[]) || []);
      setSets((s.data as SetRow[]) || []);

      // Clear drafts on fresh load
      setBlockDrafts({});
      setExDrafts({});
      setSetDrafts({});
      setStatus("");
    } catch (e: any) {
      setStatus(e.message ?? String(e));
    }
  }, [isConfigured, supabase, planItemId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Realtime auto-refresh (kept, but optimistic UI already updates immediately)
  useEffect(() => {
    if (!isConfigured || !supabase) return;
    const ch = supabase
      .channel(`strength-${planItemId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "strength_blocks", filter: `plan_item_id=eq.${planItemId}` }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "strength_exercises" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "strength_sets" }, loadAll)
      .subscribe();
    return () => { try { supabase.removeChannel(ch); ch?.unsubscribe?.(); } catch {} };
  }, [isConfigured, supabase, planItemId, loadAll]);

  /** ───────────────────────── Debounced flush ───────────────────────── */
  function scheduleFlush() {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 600);
  }
  async function flush() {
    const b = pendingBlock.current; pendingBlock.current = {};
    const e = pendingExercise.current; pendingExercise.current = {};
    const s = pendingSet.current; pendingSet.current = {};

    if (!isConfigured || !supabase) return;

    try {
      await Promise.all([
        ...Object.entries(b).map(([id, patch]) => supabase.from("strength_blocks").update(patch).eq("id", id)),
        ...Object.entries(e).map(([id, patch]) => supabase.from("strength_exercises").update(patch).eq("id", id)),
        ...Object.entries(s).map(([id, patch]) => supabase.from("strength_sets").update(patch).eq("id", id)),
      ]);
    } catch (err: any) {
      setStatus(err.message ?? String(err));
    } finally {
      // clear "Saving…" markers for notes shortly after writes land
      setTimeout(() => setSavingNotes({}), 120);
    }
  }

  /** ───────────────────────── Helpers ───────────────────────── */
  const getBlockExercises = (blockId: string) =>
    exercises.filter(e => e.block_id === blockId).sort((a,b)=>a.order_index-b.order_index);

  const getExerciseSets = (exerciseId: string) =>
    sets.filter(s => s.exercise_id === exerciseId).sort((a,b)=>a.set_index-b.set_index);

  // Preview summary for each exercise
  function exerciseSummary(exerciseId: string) {
    const ss = getExerciseSets(exerciseId);
    if (ss.length === 0) return "No sets yet";
    const repsAll = ss.map(s => s.target_reps).filter(Boolean) as number[];
    const repsLabel = repsAll.length && repsAll.every(r => r === repsAll[0]) ? `${repsAll[0]} reps` : "varied reps";
    const rpeAll = ss.map(s => s.target_rpe).filter(Boolean) as number[];
    const rpeLabel = rpeAll.length ? ` @ RPE ${rpeAll.length && (Math.min(...rpeAll) !== Math.max(...rpeAll)) ? `${Math.min(...rpeAll)}–${Math.max(...rpeAll)}` : rpeAll[0]}` : "";
    const restAll = ss.map(s => s.rest_seconds).filter(Boolean) as number[];
    const restLabel = restAll.length && restAll.every(r => r === restAll[0]) ? ` · ${restAll[0]}s rest` : "";
    return `${ss.length} set${ss.length>1?"s":""} (${repsLabel})${rpeLabel}${restLabel}`;
  }

  /** ───────────────────────── Optimistic updaters ───────────────────────── */
  function updateBlockLocal(id: string, patch: Partial<Block>) {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
    pendingBlock.current[id] = { ...(pendingBlock.current[id] || {}), ...patch };
    scheduleFlush();
  }
  function updateExerciseLocal(id: string, patch: Partial<Exercise>) {
    setExercises(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    pendingExercise.current[id] = { ...(pendingExercise.current[id] || {}), ...patch };
    scheduleFlush();
  }
  function updateSetLocal(id: string, patch: Partial<SetRow>) {
    setSets(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    pendingSet.current[id] = { ...(pendingSet.current[id] || {}), ...patch };
    scheduleFlush();
  }

  /** ───────────────────────── CRUD (with optimistic adds/deletes) ───────────────────────── */
  async function addBlock() {
    if (!isConfigured || !supabase) return;
    const order = (blocks.at(-1)?.order_index ?? -1) + 1;
    setStatus("");
    const { data, error } = await supabase
      .from("strength_blocks")
      .insert({ plan_item_id: planItemId, title: "New Block", order_index: order })
      .select("*")
      .single();
    if (!error && data) setBlocks(prev => [...prev, data as Block]);
    else setStatus(error?.message ?? "Error adding block");
  }
  async function deleteBlock(id: string) {
    if (!isConfigured || !supabase) return;
    const prev = blocks;
    setBlocks(b => b.filter(x => x.id !== id)); // optimistic
    const { error } = await supabase.from("strength_blocks").delete().eq("id", id);
    if (error) { setStatus(error.message); setBlocks(prev); }
  }

  async function addExercise(blockId: string) {
    if (!isConfigured || !supabase) return;
    const order = (getBlockExercises(blockId).at(-1)?.order_index ?? -1) + 1;
    const { data, error } = await supabase
      .from("strength_exercises")
      .insert({ block_id: blockId, name: "New Exercise", order_index: order, group_label: null, demo_url: null })
      .select("*")
      .single();
    if (!error && data) setExercises(prev => [...prev, data as Exercise]);
    else setStatus(error?.message ?? "Error adding exercise");
  }
  async function deleteExercise(id: string) {
    if (!isConfigured || !supabase) return;
    const prev = exercises;
    setExercises(e => e.filter(x => x.id !== id)); // optimistic
    const { error } = await supabase.from("strength_exercises").delete().eq("id", id);
    if (error) { setStatus(error.message); setExercises(prev); }
  }

  async function addSet(exerciseId: string) {
    if (!isConfigured || !supabase) return;
    const order = (getExerciseSets(exerciseId).at(-1)?.set_index ?? 0) + 1;
    const { data, error } = await supabase
      .from("strength_sets")
      .insert({ exercise_id: exerciseId, set_index: order, target_reps: 8, rest_seconds: 90 })
      .select("*")
      .single();
    if (!error && data) setSets(prev => [...prev, data as SetRow]);
    else setStatus(error?.message ?? "Error adding set");
  }
  async function deleteSet(id: string) {
    if (!isConfigured || !supabase) return;
    const prev = sets;
    setSets(s => s.filter(x => x.id !== id)); // optimistic
    const { error } = await supabase.from("strength_sets").delete().eq("id", id);
    if (error) { setStatus(error.message); setSets(prev); }
  }

  /** ───────────────────────── Notes autosave helpers ───────────────────────── */
  function draftBlock(id: string, patch: Partial<BlockDraft>) {
    setBlockDrafts(p => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }));
  }
  function draftExercise(id: string, patch: Partial<ExDraft>) {
    setExDrafts(p => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }));
  }
  function draftSet(id: string, patch: Partial<SetDraft>) {
    setSetDrafts(p => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }));
  }

  function scheduleBlockNoteSave(id: string, text: string, immediate = false) {
    if (blockNoteTimers.current[id]) clearTimeout(blockNoteTimers.current[id]!);
    const run = () => {
      setSavingNotes(p => ({ ...p, [id]: true }));
      updateBlockLocal(id, { notes: text });
    };
    if (immediate) run();
    else blockNoteTimers.current[id] = setTimeout(run, 700);
  }

  function scheduleSetNoteSave(id: string, text: string, immediate = false) {
    if (setNoteTimers.current[id]) clearTimeout(setNoteTimers.current[id]!);
    const run = () => {
      setSavingNotes(p => ({ ...p, [id]: true }));
      updateSetLocal(id, { notes: text });
    };
    if (immediate) run();
    else setNoteTimers.current[id] = setTimeout(run, 700);
  }

  /** ───────────────────────── Render ───────────────────────── */
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Strength Builder</h3>
        <span className="text-sm ml-auto" style={{ color: "var(--muted)" }}>{status}</span>
        <button className="btn btn-dark" onClick={addBlock}>+ Add Block</button>
      </div>

      <div className="mt-3 space-y-4">
        {blocks.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>No blocks yet. Add your first block.</div>
        ) : blocks
          .slice() // don't mutate
          .sort((a,b)=>a.order_index-b.order_index)
          .map(b => {
            const bd = blockDrafts[b.id] || {};
            const titleDisplay = bd.title ?? b.title;
            const notesDisplay = bd.notesStr ?? (b.notes ?? "");
            return (
              <div key={b.id} className="card p-3">
                <div className="flex gap-2" style={{flexWrap:"wrap"}}>
                  <input
                    className="px-3 py-2 rounded bg-white/5 border border-white/10"
                    placeholder="Block title"
                    value={titleDisplay}
                    onChange={e => {
                      draftBlock(b.id, { title: e.target.value });
                      // Commit on blur only (titles don't need every keystroke saved)
                    }}
                    onBlur={e => {
                      draftBlock(b.id, { title: undefined });
                      updateBlockLocal(b.id, { title: e.target.value.trim() || "Untitled Block" });
                    }}
                  />
                  <textarea
                    className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10"
                    placeholder="Block notes"
                    rows={2}
                    value={notesDisplay}
                    onChange={e => {
                      const val = e.target.value;
                      draftBlock(b.id, { notesStr: val });
                      scheduleBlockNoteSave(b.id, val);
                    }}
                    onBlur={e => scheduleBlockNoteSave(b.id, e.target.value, true)}
                  />
                  <button className="btn btn-dark ml-auto" onClick={() => deleteBlock(b.id)}>Delete Block</button>
                  <button className="btn" onClick={() => addExercise(b.id)}>+ Add Exercise</button>
                </div>
                {savingNotes[b.id] ? <div className="text-xs opacity-70 mt-1">Saving…</div> : null}

                {/* Exercises */}
                <div className="mt-3 grid" style={{gap:12}}>
                  {getBlockExercises(b.id).length === 0 ? (
                    <div className="text-sm" style={{ color: "var(--muted)" }}>No exercises.</div>
                  ) : getBlockExercises(b.id).map(ex => {
                    const ed = exDrafts[ex.id] || {};
                    const groupDisplay = ed.group_label ?? (ex.group_label ?? "");
                    const nameDisplay = ed.name ?? ex.name;
                    const demoDisplay = ed.demo_url ?? (ex.demo_url ?? "");
                    return (
                      <div key={ex.id} className="card p-3">
                        <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
                          <input
                            className="px-3 py-2 rounded bg-white/5 border border-white/10"
                            placeholder="A1 / A2 (optional)"
                            style={{width:90}}
                            value={groupDisplay}
                            onChange={e => {
                              const val = e.target.value;
                              draftExercise(ex.id, { group_label: val });
                            }}
                            onBlur={e => {
                              draftExercise(ex.id, { group_label: undefined });
                              updateExerciseLocal(ex.id, { group_label: e.target.value || null });
                            }}
                          />
                          <input
                            className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10"
                            placeholder="Exercise name (e.g., Back Squat)"
                            value={nameDisplay}
                            onChange={e => draftExercise(ex.id, { name: e.target.value })}
                            onBlur={e => {
                              draftExercise(ex.id, { name: undefined });
                              updateExerciseLocal(ex.id, { name: e.target.value.trim() || "Untitled Exercise" });
                            }}
                          />
                          <input
                            className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10"
                            placeholder="Demo video URL (optional)"
                            value={demoDisplay}
                            onChange={e => draftExercise(ex.id, { demo_url: e.target.value })}
                            onBlur={e => {
                              draftExercise(ex.id, { demo_url: undefined });
                              updateExerciseLocal(ex.id, { demo_url: e.target.value || null });
                            }}
                          />
                          <button className="btn btn-dark ml-auto" onClick={() => deleteExercise(ex.id)}>Delete Exercise</button>
                          <button className="btn" onClick={() => addSet(ex.id)}>+ Add Set</button>
                        </div>

                        {/* Live preview pill */}
                        <div className="mt-2 text-sm opacity-80">
                          {(groupDisplay ? `${groupDisplay} ` : "")}{nameDisplay} — {exerciseSummary(ex.id)}
                        </div>

                        {/* Sets grid */}
                        <div className="mt-3" style={{overflowX:"auto"}}>
                          <table className="w-full text-sm">
                            <thead>
                              <tr style={{ color: "var(--muted)" }}>
                                <th className="text-left">Set</th>
                                <th className="text-left">Reps</th>
                                <th className="text-left">%RM</th>
                                <th className="text-left">RPE</th>
                                <th className="text-left">Load (kg)</th>
                                <th className="text-left">Rest (s)</th>
                                <th className="text-left">Notes</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {getExerciseSets(ex.id).map(s => {
                                const sd = setDrafts[s.id] || {};
                                const notesDisplay = sd.notesStr ?? (s.notes ?? "");
                                return (
                                  <tr key={s.id}>
                                    <td>
                                      <input
                                        type="number"
                                        className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10"
                                        value={s.set_index}
                                        onChange={e => updateSetLocal(s.id, { set_index: Number(e.target.value || 0) })}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        className="w-20 px-2 py-1 rounded bg-white/5 border border-white/10"
                                        value={s.target_reps ?? 0}
                                        onChange={e => updateSetLocal(s.id, { target_reps: e.target.value === "" ? null : Number(e.target.value) })}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        className="w-24 px-2 py-1 rounded bg-white/5 border border-white/10"
                                        value={s.target_percent_rm ?? 0}
                                        onChange={e => updateSetLocal(s.id, { target_percent_rm: e.target.value === "" ? null : Number(e.target.value) })}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        className="w-20 px-2 py-1 rounded bg-white/5 border border-white/10"
                                        value={s.target_rpe ?? 0}
                                        onChange={e => updateSetLocal(s.id, { target_rpe: e.target.value === "" ? null : Number(e.target.value) })}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        className="w-24 px-2 py-1 rounded bg-white/5 border border-white/10"
                                        value={s.target_load_kg ?? 0}
                                        onChange={e => updateSetLocal(s.id, { target_load_kg: e.target.value === "" ? null : Number(e.target.value) })}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        className="w-24 px-2 py-1 rounded bg-white/5 border border-white/10"
                                        value={s.rest_seconds ?? 0}
                                        onChange={e => updateSetLocal(s.id, { rest_seconds: e.target.value === "" ? null : Number(e.target.value) })}
                                      />
                                    </td>
                                    <td>
                                      <textarea
                                        className="w-48 px-2 py-1 rounded bg-white/5 border border-white/10"
                                        rows={1}
                                        placeholder="Notes"
                                        value={notesDisplay}
                                        onChange={e => {
                                          const val = e.target.value;
                                          draftSet(s.id, { notesStr: val });
                                          scheduleSetNoteSave(s.id, val);
                                        }}
                                        onBlur={e => scheduleSetNoteSave(s.id, e.target.value, true)}
                                      />
                                      {savingNotes[s.id] ? <div className="text-xs opacity-70 mt-1">Saving…</div> : null}
                                    </td>
                                    <td>
                                      <button className="btn btn-dark" onClick={() => deleteSet(s.id)}>Delete</button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
