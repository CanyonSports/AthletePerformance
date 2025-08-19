"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { getSupabase } from "@/lib/supabaseClient";
import { Save, Plus, Trash2, ArrowLeft, Copy } from "lucide-react";

/* ----------------------------- Types ----------------------------- */

type ProgramItemRow = {
  id?: string;
  program_id: string;
  day_index: number;
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  structure: any | null; // stored JSON
  created_at?: string;
};

type PlanSet = {
  reps: string;          // free text (e.g. "5", "5-3-1", "AMRAP")
  weight: string;        // free text ("100kg", "80%", "BW")
  rpe: number | null;    // planned target, optional
  notes: string;         // per-set notes (tempo, cue, etc.)
};

type Exercise = {
  name: string;
  rest: string;
  notes: string;
  planSets: PlanSet[];
};

type DayStructure = {
  exercises: Exercise[];
  notes: string;
};

/* ----------------------------- Utils ----------------------------- */

const weekdayOf = (idx: number) => ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][idx % 7] || "Day";
const weekNumber = (idx: number) => Math.floor(idx / 7) + 1;

const emptyPlanSet = (): PlanSet => ({ reps: "", weight: "", rpe: null, notes: "" });
const emptyExercise = (): Exercise => ({ name: "", rest: "", notes: "", planSets: [emptyPlanSet(), emptyPlanSet(), emptyPlanSet()] });

function migrateLegacyStructure(raw: any): DayStructure {
  // Legacy had exercises with: { name, sets, reps, load, rest, notes }
  // New stores planSets: PlanSet[]
  if (!raw || typeof raw !== "object") return { exercises: [], notes: "" };
  const legacyEx = Array.isArray(raw.exercises) ? raw.exercises : [];
  if (legacyEx.length === 0) {
    return {
      exercises: [],
      notes: typeof raw.notes === "string" ? raw.notes : "",
    };
  }
  const exercises: Exercise[] = legacyEx.map((ex: any) => {
    // derive count
    let cnt = 3;
    if (typeof ex.sets === "number" && ex.sets > 0) cnt = ex.sets;
    else {
      const m = typeof ex.reps === "string" ? ex.reps.match(/^(\d+)/) : null;
      if (m) cnt = Math.max(1, parseInt(m[1], 10));
    }
    const reps = (typeof ex.reps === "string" ? ex.reps : "").trim();
    const weight = (typeof ex.load === "string" ? ex.load : "").trim();
    const planSets: PlanSet[] = Array.from({ length: cnt }, () => ({
      reps,
      weight,
      rpe: null,
      notes: "",
    }));
    return {
      name: typeof ex.name === "string" ? ex.name : "",
      rest: typeof ex.rest === "string" ? ex.rest : "",
      notes: typeof ex.notes === "string" ? ex.notes : "",
      planSets,
    };
  });
  return {
    exercises,
    notes: typeof raw.notes === "string" ? raw.notes : "",
  };
}

/* ----------------------------- Page ----------------------------- */

export default function DayBuilderPage({
  params,
}: {
  params: { programId: string; dayIndex: string };
}) {
  const router = useRouter();
  const search = useSearchParams();

  const supabase = useMemo(() => { try { return getSupabase(); } catch { return null; } }, []);
  const isConfigured = Boolean(supabase);

  const programId = params.programId;
  const dayIndex = Math.max(0, parseInt(params.dayIndex || "0", 10));
  const weekday = weekdayOf(dayIndex);
  const wkNum = weekNumber(dayIndex);

  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  // program item state
  const [rowId, setRowId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState<string>("");
  const [details, setDetails] = useState<string>("");
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const [structure, setStructure] = useState<DayStructure>({ exercises: [], notes: "" });

  // where to go back
  const defaultReturn = `/training/programs?open=${programId}&focus=${dayIndex}`;
  const returnTo = decodeURIComponent(search.get("returnTo") || defaultReturn);

  /* ----------------------------- Load (no .single()) ----------------------------- */
  const loadOrInit = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    setLoading(true);
    setNote("");
    try {
      const { data, error } = await supabase
        .from("program_items")
        .select("id, program_id, day_index, title, details, duration_min, rpe, structure, created_at")
        .eq("program_id", programId)
        .eq("day_index", dayIndex)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;

      const row = (data && data[0]) as ProgramItemRow | undefined;
      if (row) {
        setRowId(row.id);
        setTitle(row.title || "");
        setDetails(row.details || "");
        setDurationMin(row.duration_min ?? null);
        setRpe(row.rpe ?? null);

        // migrate or accept new format
        const raw = row.structure;
        let next: DayStructure;
        if (raw && typeof raw === "object" && Array.isArray(raw.exercises)) {
          // new or legacy—detect presence of planSets
          const looksNew = raw.exercises.some((e: any) => Array.isArray(e?.planSets));
          next = looksNew ? {
            exercises: raw.exercises.map((e: any) => ({
              name: e.name || "",
              rest: e.rest || "",
              notes: e.notes || "",
              planSets: Array.isArray(e.planSets) && e.planSets.length > 0
                ? e.planSets.map((ps: any) => ({
                    reps: typeof ps?.reps === "string" ? ps.reps : "",
                    weight: typeof ps?.weight === "string" ? ps.weight : "",
                    rpe: typeof ps?.rpe === "number" ? ps.rpe : (ps?.rpe == null ? null : Number(ps.rpe) || null),
                    notes: typeof ps?.notes === "string" ? ps.notes : "",
                  }))
                : [emptyPlanSet(), emptyPlanSet(), emptyPlanSet()],
            })),
            notes: typeof raw.notes === "string" ? raw.notes : "",
          } : migrateLegacyStructure(raw);
        } else {
          next = { exercises: [], notes: "" };
        }
        setStructure(next);
      } else {
        // initialize empty
        setRowId(undefined);
        setTitle("");
        setDetails("");
        setDurationMin(null);
        setRpe(null);
        setStructure({ exercises: [], notes: "" });
      }
    } catch (e: any) {
      setNote(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, programId, dayIndex]);

  useEffect(() => { loadOrInit(); }, [loadOrInit]);

  /* ----------------------------- Save (upsert + fallback) ----------------------------- */
  const saveDay = useCallback(async (goBack: boolean) => {
    if (!isConfigured || !supabase) return;
    setLoading(true);
    setNote("");
    try {
      const payload = {
        program_id: programId,
        day_index: dayIndex,
        title: (title || "").trim() || `Week ${wkNum} ${weekday}`,
        details: (details || "").trim() || null,
        duration_min: durationMin ?? null,
        rpe: rpe ?? null,
        structure: {
          exercises: structure.exercises.map((ex) => ({
            name: ex.name || "",
            rest: ex.rest || "",
            notes: ex.notes || "",
            planSets: (ex.planSets && ex.planSets.length > 0 ? ex.planSets : [emptyPlanSet()]).map(ps => ({
              reps: ps.reps || "",
              weight: ps.weight || "",
              rpe: ps.rpe == null ? null : Number(ps.rpe),
              notes: ps.notes || "",
            })),
          })),
          notes: structure.notes || "",
        },
      };

      // Preferred upsert (requires unique(program_id, day_index))
      let gotId: string | undefined;
      const { data: upserted, error: upErr } = await supabase
        .from("program_items")
        .upsert(payload as any, { onConflict: "program_id,day_index" })
        .select("id")
        .single();

      if (upErr) {
        // Fallback if unique constraint doesn't exist yet
        if (rowId) {
          const { error: updErr } = await supabase.from("program_items").update(payload).eq("id", rowId);
          if (updErr) throw updErr;
          gotId = rowId;
        } else {
          const { data: ins, error: insErr } = await supabase
            .from("program_items")
            .insert(payload as any)
            .select("id")
            .single();
          if (insErr) throw insErr;
          gotId = (ins as any)?.id;
        }
      } else {
        gotId = (upserted as any)?.id;
      }

      setRowId(gotId);
      setNote("Saved");
      if (goBack) router.push(returnTo);
      else setTimeout(() => setNote(""), 1200);
    } catch (e: any) {
      setNote(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, rowId, programId, dayIndex, title, details, durationMin, rpe, structure, router, wkNum, weekday, returnTo]);

  /* ----------------------------- Exercise helpers ----------------------------- */
  const addExercise = () => setStructure((s) => ({ ...s, exercises: [...s.exercises, emptyExercise()] }));
  const removeExercise = (i: number) =>
    setStructure((s) => ({ ...s, exercises: s.exercises.filter((_, idx) => idx !== i) }));
  const updateExercise = (i: number, patch: Partial<Exercise>) =>
    setStructure((s) => {
      const next = s.exercises.slice();
      next[i] = { ...next[i], ...patch };
      // ensure planSets exists
      if (!Array.isArray(next[i].planSets) || next[i].planSets.length === 0) next[i].planSets = [emptyPlanSet(), emptyPlanSet(), emptyPlanSet()];
      return { ...s, exercises: next };
    });

  const addSet = (ei: number) =>
    setStructure((s) => {
      const ex = s.exercises.slice();
      const ps = ex[ei].planSets.slice();
      ps.push(emptyPlanSet());
      ex[ei] = { ...ex[ei], planSets: ps };
      return { ...s, exercises: ex };
    });

  const removeSet = (ei: number, si: number) =>
    setStructure((s) => {
      const ex = s.exercises.slice();
      const ps = ex[ei].planSets.filter((_, idx) => idx !== si);
      ex[ei] = { ...ex[ei], planSets: ps.length ? ps : [emptyPlanSet()] };
      return { ...s, exercises: ex };
    });

  const updatePlanSet = (ei: number, si: number, patch: Partial<PlanSet>) =>
    setStructure((s) => {
      const ex = s.exercises.slice();
      const ps = ex[ei].planSets.slice();
      ps[si] = { ...ps[si], ...patch };
      ex[ei] = { ...ex[ei], planSets: ps };
      return { ...s, exercises: ex };
    });

  const applyFirstToAll = (ei: number) =>
    setStructure((s) => {
      const ex = s.exercises.slice();
      const ps = ex[ei].planSets.slice();
      const first = ps[0] || emptyPlanSet();
      const applied = ps.map(() => ({ ...first }));
      ex[ei] = { ...ex[ei], planSets: applied };
      return { ...s, exercises: ex };
    });

  /* ----------------------------- Render ----------------------------- */

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <NavBar />

      <div className="mt-6 card p-4">
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => router.push(returnTo)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </button>
          <div className="ml-2">
            <h1 className="text-xl font-semibold">Day Builder</h1>
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Program day: <strong>Week {wkNum}</strong> • <strong>{weekday}</strong>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn" onClick={() => saveDay(false)} disabled={loading}>
              <Save className="w-4 h-4 mr-1" /> Save
            </button>
            <button className="btn btn-dark" onClick={() => saveDay(true)} disabled={loading}>
              Save & Back
            </button>
          </div>
        </div>
        {note ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div> : null}
      </div>

      {/* Basics */}
      <div className="mt-4 card p-4">
        <div className="grid md:grid-cols-4 gap-3">
          <label className="block md:col-span-2">
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Session Title</div>
            <input className="field w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Lower Body Strength" />
          </label>
          <label className="block">
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Duration (min)</div>
            <input type="number" className="field w-full" value={durationMin ?? ""} onChange={(e) => setDurationMin(e.target.value ? parseInt(e.target.value, 10) : null)} placeholder="e.g., 60" />
          </label>
          <label className="block">
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>RPE (session)</div>
            <input type="number" className="field w-full" value={rpe ?? ""} onChange={(e) => setRpe(e.target.value ? parseInt(e.target.value, 10) : null)} placeholder="e.g., 7" />
          </label>
        </div>

        <label className="block mt-3">
          <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Notes (optional)</div>
          <textarea className="field w-full" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Any overall instructions for the day…" />
        </label>
      </div>

      {/* Exercises */}
      <div className="mt-4 card p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Exercises</h3>
          <button className="btn btn-dark ml-auto" onClick={addExercise}>
            <Plus className="w-4 h-4 mr-1" /> Add Exercise
          </button>
        </div>

        {structure.exercises.length === 0 ? (
          <div className="text-sm mt-2" style={{ color: "var(--muted)" }}>No exercises yet.</div>
        ) : (
          <div className="mt-3 space-y-4">
            {structure.exercises.map((ex, ei) => (
              <div key={ei} className="rounded border bg-white/5 p-3" style={{ borderColor: "#ffffff22" }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="block flex-1 min-w-[220px]">
                    <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Exercise Name</div>
                    <input className="field w-full" value={ex.name} onChange={(e) => updateExercise(ei, { name: e.target.value })} placeholder={`Exercise ${ei + 1}`} />
                  </label>
                  <label className="block">
                    <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Rest</div>
                    <input className="field w-40" value={ex.rest} onChange={(e) => updateExercise(ei, { rest: e.target.value })} placeholder="2–3 min" />
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    <button className="btn" onClick={() => applyFirstToAll(ei)} title="Copy first set values to all sets">
                      <Copy className="w-4 h-4 mr-1" /> Apply first to all
                    </button>
                    <button className="btn btn-dark" onClick={() => removeExercise(ei)} title="Remove exercise">
                      <Trash2 className="w-4 h-4 mr-1" /> Remove Exercise
                    </button>
                  </div>
                </div>

                <label className="block mt-2">
                  <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Exercise Notes (optional)</div>
                  <textarea className="field w-full" rows={2} value={ex.notes} onChange={(e) => updateExercise(ei, { notes: e.target.value })} placeholder="Depth, tempo, cues…" />
                </label>

                {/* Planned Sets */}
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-xs" style={{ color: "var(--muted)" }}>
                      <tr>
                        <th className="text-left py-1 pr-3">Set</th>
                        <th className="text-left py-1 pr-3">Planned Reps</th>
                        <th className="text-left py-1 pr-3">Planned Weight</th>
                        <th className="text-left py-1 pr-3">Planned RPE</th>
                        <th className="text-left py-1 pr-3">Notes</th>
                        <th className="text-left py-1 pr-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ex.planSets.map((ps, si) => (
                        <tr key={si} className="border-t" style={{ borderColor: "#ffffff14" }}>
                          <td className="py-1 pr-3 font-medium">#{si + 1}</td>
                          <td className="py-1 pr-3">
                            <input className="field w-28" value={ps.reps} placeholder="e.g. 5" onChange={(e) => updatePlanSet(ei, si, { reps: e.target.value })} />
                          </td>
                          <td className="py-1 pr-3">
                            <input className="field w-28" value={ps.weight} placeholder="e.g. 100kg / 80%" onChange={(e) => updatePlanSet(ei, si, { weight: e.target.value })} />
                          </td>
                          <td className="py-1 pr-3">
                            <input type="number" className="field w-20" value={ps.rpe ?? ""} placeholder="7–10" onChange={(e) => updatePlanSet(ei, si, { rpe: e.target.value ? parseInt(e.target.value, 10) : null })} />
                          </td>
                          <td className="py-1 pr-3">
                            <input className="field w-56" value={ps.notes} placeholder="tempo / cue" onChange={(e) => updatePlanSet(ei, si, { notes: e.target.value })} />
                          </td>
                          <td className="py-1 pr-3">
                            <button className="btn btn-dark" onClick={() => removeSet(ei, si)} title="Remove set">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-2">
                  <button className="btn" onClick={() => addSet(ei)}>
                    <Plus className="w-4 h-4 mr-1" /> Add Set
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
