// components/CoachAuthorEditor.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";

type Sport = "climbing" | "ski" | "mtb" | "running";

type PlanItem = {
  id: string;
  user_id: string;
  sport: Sport;
  session_date: string; // yyyy-mm-dd
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

type Exercise = {
  id: string;
  user_id: string;
  plan_item_id: string;
  name: string;
  exercise_key: string | null;
  superset_key: string | null;      // e.g. 'A', 'B', null for solo
  order_index: number;              // for ordering within a session
  target_sets: number | null;
  target_reps: number | null;
  target_rpe: number | null;
  target_percent_rm: number | null;
  rec_weight_kg: number | null;
  notes: string | null;
  video_url: string | null;
};

type SetRow = {
  id: string;
  user_id: string;
  exercise_id: string;
  set_number: number;               // 1..N
  target_reps: number | null;
  target_weight_kg: number | null;
  target_rpe: number | null;
  target_percent_rm: number | null;
  actual_reps: number | null;       // athletes fill elsewhere
  actual_weight_kg: number | null;  // athletes fill elsewhere
  completed: boolean;
};

function startOfWeekISO(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday=0
  x.setDate(x.getDate() - day);
  x.setHours(0,0,0,0);
  return x.toISOString().slice(0,10);
}
function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}
function toISO(d: Date) { d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }

function NumberField({
  value, onChange, placeholder, className, step, min, max,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  placeholder?: string;
  className?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <input
      className={`field ${className ?? ""}`}
      type="number"
      step={step ?? 1}
      min={min}
      max={max}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : Number(v));
      }}
    />
  );
}

export default function CoachAuthorEditor({
  athleteId,
  initialSport = "climbing",
}: {
  athleteId: string;
  initialSport?: Sport;
}) {
  // Supabase client supporting either `getSupabase()` or exported const
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  // State
  const [note, setNote] = useState("");
  const [sport, setSport] = useState<Sport>(initialSport);
  const [weekStart, setWeekStart] = useState<string>(startOfWeekISO(new Date()));
  const [sessions, setSessions] = useState<PlanItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const [exs, setExs] = useState<Exercise[]>([]);
  const [setsMap, setSetsMap] = useState<Record<string, SetRow[]>>({});
  const [saving, setSaving] = useState(false);

  // Load sessions for week
  const loadWeek = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) return;
    try {
      const end = addDaysISO(weekStart, 7);
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("user_id", athleteId)
        .eq("sport", sport)
        .gte("session_date", weekStart)
        .lt("session_date", end)
        .order("session_date", { ascending: true });
      if (error) throw error;
      setSessions((data || []) as PlanItem[]);
      if ((data || []).length && !selectedSessionId) {
        setSelectedSessionId((data as any)[0].id);
      }
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase, athleteId, sport, weekStart, selectedSessionId]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  // Load exercises + sets for selected session
  const loadSessionContent = useCallback(async () => {
    if (!isConfigured || !supabase || !selectedSessionId) { setExs([]); setSetsMap({}); return; }
    try {
      const { data: eRows, error: eErr } = await supabase
        .from("training_exercises")
        .select("*")
        .eq("plan_item_id", selectedSessionId)
        .order("superset_key", { ascending: true, nullsFirst: true })
        .order("order_index", { ascending: true });
      if (eErr) throw eErr;
      const exercises = (eRows || []) as Exercise[];
      setExs(exercises);

      const ids = exercises.map(e => e.id);
      if (!ids.length) { setSetsMap({}); return; }
      const { data: sRows, error: sErr } = await supabase
        .from("training_sets")
        .select("*")
        .in("exercise_id", ids)
        .order("exercise_id", { ascending: true })
        .order("set_number", { ascending: true });
      if (sErr) throw sErr;
      const map: Record<string, SetRow[]> = {};
      for (const r of (sRows || []) as SetRow[]) (map[r.exercise_id] ||= []).push(r);
      setSetsMap(map);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase, selectedSessionId]);

  useEffect(() => { loadSessionContent(); }, [loadSessionContent]);

  // Session CRUD
  async function createSession() {
    if (!isConfigured || !supabase) return;
    try {
      setSaving(true);
      const { data, error } = await supabase
        .from("training_plan_items")
        .insert({
          user_id: athleteId,
          sport,
          session_date: toISO(new Date()),
          title: "New Session",
          details: "",
          duration_min: null,
          rpe: null,
          status: "planned",
        })
        .select("*")
        .single();
      if (error) throw error;
      setSelectedSessionId((data as any).id);
      await loadWeek();
    } catch (e: any) { setNote(e.message ?? String(e)); }
    finally { setSaving(false); }
  }

  async function patchSession(id: string, patch: Partial<PlanItem>) {
    if (!isConfigured || !supabase) return;
    const { error } = await supabase.from("training_plan_items").update(patch).eq("id", id);
    if (error) setNote(error.message);
    else setSessions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  async function deleteSession(id: string) {
    if (!isConfigured || !supabase) return;
    if (!confirm("Delete this session? Exercises and sets will also be deleted.")) return;
    const { error } = await supabase.from("training_plan_items").delete().eq("id", id);
    if (error) setNote(error.message);
    else {
      setSelectedSessionId(null);
      await loadWeek();
      setExs([]); setSetsMap({});
    }
  }

  // Exercise CRUD
  async function addExercise() {
    if (!isConfigured || !supabase || !selectedSessionId) return;
    const order = (exs[exs.length - 1]?.order_index ?? 0) + 10;
    const { data, error } = await supabase
      .from("training_exercises")
      .insert({
        user_id: athleteId,
        plan_item_id: selectedSessionId,
        name: "New Exercise",
        exercise_key: null,
        superset_key: null,
        order_index: order,
        target_sets: 3,
        target_reps: 10,
        target_rpe: null,
        target_percent_rm: null,
        rec_weight_kg: null,
        notes: "",
        video_url: null,
      })
      .select("*")
      .single();
    if (error) { setNote(error.message); return; }
    setExs(prev => [...prev, data as any]);
  }

  async function updateExercise(id: string, patch: Partial<Exercise>) {
    if (!isConfigured || !supabase) return;
    const { error } = await supabase.from("training_exercises").update(patch).eq("id", id);
    if (error) setNote(error.message);
    else setExs(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }

  async function deleteExercise(id: string) {
    if (!isConfigured || !supabase) return;
    if (!confirm("Delete this exercise and its sets?")) return;
    const { error } = await supabase.from("training_exercises").delete().eq("id", id);
    if (error) setNote(error.message);
    else {
      setExs(prev => prev.filter(e => e.id !== id));
      setSetsMap(prev => {
        const m = { ...prev }; delete m[id]; return m;
      });
    }
  }

  // Reorder exercises (swap indices)
  async function moveExercise(id: string, dir: "up" | "down") {
    const idx = exs.findIndex(e => e.id === id);
    if (idx < 0) return;
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= exs.length) return;

    const a = exs[idx], b = exs[swapIdx];
    const aOrder = a.order_index, bOrder = b.order_index;

    // Optimistic
    const next = [...exs];
    next[idx] = { ...b, order_index: aOrder };
    next[swapIdx] = { ...a, order_index: bOrder };
    setExs(next);

    // Persist
    const { error: e1 } = await supabase.from("training_exercises").update({ order_index: bOrder }).eq("id", a.id);
    const { error: e2 } = await supabase.from("training_exercises").update({ order_index: aOrder }).eq("id", b.id);
    if (e1 || e2) {
      // revert on failure
      setExs(exs);
      setNote((e1?.message || e2?.message) ?? "Reorder failed");
    }
  }

  // Sets CRUD
  async function addSet(exerciseId: string) {
    if (!isConfigured || !supabase) return;
    const rows = setsMap[exerciseId] || [];
    const nextNo = (rows[rows.length - 1]?.set_number ?? 0) + 1;
    const { data, error } = await supabase
      .from("training_sets")
      .insert({
        user_id: athleteId,
        exercise_id: exerciseId,
        set_number: nextNo,
        target_reps: null,
        target_weight_kg: null,
        target_rpe: null,
        target_percent_rm: null,
        actual_reps: null,
        actual_weight_kg: null,
        completed: false,
      })
      .select("*")
      .single();
    if (error) { setNote(error.message); return; }
    setSetsMap(prev => ({ ...prev, [exerciseId]: [...(prev[exerciseId] || []), data as any] }));
  }

  async function updateSet(row: SetRow, patch: Partial<SetRow>) {
    if (!isConfigured || !supabase) return;
    const next = { ...row, ...patch };
    setSetsMap(prev => ({
      ...prev,
      [row.exercise_id]: (prev[row.exercise_id] || []).map(s => s.id === row.id ? next : s),
    }));
    const { error } = await supabase.from("training_sets").update(patch).eq("id", row.id);
    if (error) setNote(error.message);
  }

  async function deleteSet(row: SetRow) {
    if (!isConfigured || !supabase) return;
    const { error } = await supabase.from("training_sets").delete().eq("id", row.id);
    if (error) setNote(error.message);
    else {
      setSetsMap(prev => ({
        ...prev,
        [row.exercise_id]: (prev[row.exercise_id] || []).filter(s => s.id !== row.id),
      }));
    }
  }

  async function moveSet(row: SetRow, dir: "up" | "down") {
    const list = setsMap[row.exercise_id] || [];
    const idx = list.findIndex(s => s.id === row.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const a = list[idx], b = list[swapIdx];

    // Optimistic swap set_number
    const nextList = [...list];
    nextList[idx] = { ...b, set_number: a.set_number };
    nextList[swapIdx] = { ...a, set_number: b.set_number };
    setSetsMap(prev => ({ ...prev, [row.exercise_id]: nextList }));

    // Persist
    const { error: e1 } = await supabase.from("training_sets").update({ set_number: nextList[idx].set_number }).eq("id", b.id);
    const { error: e2 } = await supabase.from("training_sets").update({ set_number: nextList[swapIdx].set_number }).eq("id", a.id);
    if (e1 || e2) {
      setSetsMap(prev => ({ ...prev, [row.exercise_id]: list })); // revert
      setNote((e1?.message || e2?.message) ?? "Reorder failed");
    }
  }

  // UI bits
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)),
    [weekStart]
  );

  const selectedSession = sessions.find(s => s.id === selectedSessionId) || null;

  return (
    <div className="card p-4 mt-6">
      <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
        <h3 className="text-lg font-semibold">Exercise Program Builder</h3>
        {note && <span className="text-xs" style={{ color: "#fca5a5" }}>{note}</span>}
        <div className="ml-auto flex items-center gap-2">
          <select className="field" value={sport} onChange={e => setSport(e.target.value as Sport)}>
            <option value="climbing">Climbing</option>
            <option value="ski">Ski</option>
            <option value="mtb">MTB</option>
            <option value="running">Running</option>
          </select>
          <div className="flex items-center gap-2">
            <button className="btn btn-dark" onClick={() => setWeekStart(addDaysISO(weekStart, -7))}>←</button>
            <input
              className="field"
              type="date"
              value={weekStart}
              onChange={(e) => {
                const v = e.target.value ? new Date(e.target.value) : new Date();
                setWeekStart(startOfWeekISO(v));
              }}
            />
            <button className="btn btn-dark" onClick={() => setWeekStart(addDaysISO(weekStart, +7))}>→</button>
          </div>
          <button className="btn btn-dark" disabled={saving} onClick={createSession}>+ New Session</button>
        </div>
      </div>

      {/* Sessions of the week */}
      <div className="mt-3 grid" style={{ gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 8 }}>
        {weekDays.map((iso) => {
          const daySessions = sessions.filter(s => s.session_date === iso);
          return (
            <div key={iso} className="rounded border border-white/10 p-2">
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </div>
              {daySessions.length === 0 ? (
                <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>—</div>
              ) : daySessions.map(s => (
                <button
                  key={s.id}
                  className={`w-full text-left mt-2 px-2 py-1 rounded ${s.id === selectedSessionId ? "bg-white/10" : "bg-white/5"} hover:bg-white/10`}
                  onClick={() => setSelectedSessionId(s.id)}
                  title="Open in editor"
                >
                  <div className="text-xs font-medium truncate">{s.title || "Session"}</div>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Editor panel */}
      {!selectedSession ? (
        <div className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
          Select a session above (or create one) to start authoring.
        </div>
      ) : (
        <div className="mt-6 card p-4">
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            <h4 className="font-semibold">Editing Session</h4>
            <input
              className="field w-44"
              type="date"
              value={selectedSession.session_date}
              onChange={(e) => patchSession(selectedSession.id, { session_date: e.target.value })}
              title="Session date"
            />
            <input
              className="field flex-1"
              placeholder="Session title"
              value={selectedSession.title}
              onChange={(e) => patchSession(selectedSession.id, { title: e.target.value })}
            />
            <NumberField
              className="w-28"
              placeholder="Duration (min)"
              value={selectedSession.duration_min}
              onChange={(n) => patchSession(selectedSession.id, { duration_min: n })}
            />
            <button className="btn btn-dark" onClick={() => deleteSession(selectedSession.id)}>Delete Session</button>
          </div>

          <textarea
            className="field w-full mt-3"
            rows={3}
            placeholder="Session notes / warm-up / cool-down"
            value={selectedSession.details ?? ""}
            onChange={(e) => patchSession(selectedSession.id, { details: e.target.value })}
          />

          {/* Exercises list */}
          <div className="mt-5 flex items-center gap-2">
            <h5 className="font-semibold">Exercises</h5>
            <button className="btn btn-dark" onClick={addExercise}>+ Add Exercise</button>
          </div>

          {exs.length === 0 ? (
            <div className="text-sm mt-2" style={{ color: "var(--muted)" }}>No exercises yet.</div>
          ) : (
            <div className="mt-3 grid" style={{ gridTemplateColumns: "repeat(1, minmax(0, 1fr))", gap: 10 }}>
              {exs.map((ex, idx) => {
                const rows = setsMap[ex.id] || [];
                return (
                  <div key={ex.id} className="rounded border border-white/10 p-3">
                    {/* Exercise header */}
                    <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                      <input
                        className="field flex-1"
                        placeholder="Exercise name"
                        value={ex.name}
                        onChange={(e) => updateExercise(ex.id, { name: e.target.value })}
                      />
                      <select
                        className="field w-28"
                        title="Superset group"
                        value={ex.superset_key ?? ""}
                        onChange={(e) => updateExercise(ex.id, { superset_key: e.target.value || null })}
                      >
                        <option value="">Solo</option>
                        <option value="A">Superset A</option>
                        <option value="B">Superset B</option>
                        <option value="C">Superset C</option>
                        <option value="D">Superset D</option>
                      </select>
                      <button className="btn btn-dark" onClick={() => moveExercise(ex.id, "up")} disabled={idx === 0}>↑</button>
                      <button className="btn btn-dark" onClick={() => moveExercise(ex.id, "down")} disabled={idx === exs.length - 1}>↓</button>
                      <button className="btn btn-dark" onClick={() => deleteExercise(ex.id)}>Delete</button>
                    </div>

                    {/* Targets / cues */}
                    <div className="mt-2 grid" style={{ gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 8 }}>
                      <NumberField
                        value={ex.target_sets}
                        onChange={(n) => updateExercise(ex.id, { target_sets: n })}
                        placeholder="Sets"
                      />
                      <NumberField
                        value={ex.target_reps}
                        onChange={(n) => updateExercise(ex.id, { target_reps: n })}
                        placeholder="Reps"
                      />
                      <NumberField
                        value={ex.target_rpe}
                        onChange={(n) => updateExercise(ex.id, { target_rpe: n })}
                        placeholder="RPE"
                        step={0.5}
                        min={1} max={10}
                      />
                      <NumberField
                        value={ex.target_percent_rm}
                        onChange={(n) => updateExercise(ex.id, { target_percent_rm: n })}
                        placeholder="%1RM"
                        step={1}
                        min={0} max={100}
                      />
                      <NumberField
                        value={ex.rec_weight_kg}
                        onChange={(n) => updateExercise(ex.id, { rec_weight_kg: n })}
                        placeholder="Rec kg"
                        step={0.5}
                        min={0}
                      />
                    </div>

                    <div className="mt-2 grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
                      <input
                        className="field"
                        placeholder="Exercise key (for 1RM lookup, e.g. 'back_squat')"
                        value={ex.exercise_key ?? ""}
                        onChange={(e) => updateExercise(ex.id, { exercise_key: e.target.value || null })}
                      />
                      <input
                        className="field"
                        placeholder="Demo video URL (YouTube or any link)"
                        value={ex.video_url ?? ""}
                        onChange={(e) => updateExercise(ex.id, { video_url: e.target.value || null })}
                      />
                    </div>

                    <textarea
                      className="field w-full mt-2"
                      rows={2}
                      placeholder="Coaching notes / tempo / cues"
                      value={ex.notes ?? ""}
                      onChange={(e) => updateExercise(ex.id, { notes: e.target.value })}
                    />

                    {/* Sets authoring */}
                    <div className="mt-3 flex items-center gap-2">
                      <h6 className="font-semibold">Sets (targets)</h6>
                      <button className="btn btn-dark" onClick={() => addSet(ex.id)}>+ Add Set</button>
                    </div>

                    <div className="mt-2 overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left" style={{ color: "var(--muted)" }}>
                            <th className="py-1 pr-2">#</th>
                            <th className="py-1 pr-2">Target Reps</th>
                            <th className="py-1 pr-2">Target kg</th>
                            <th className="py-1 pr-2">%1RM</th>
                            <th className="py-1 pr-2">RPE</th>
                            <th className="py-1 pr-2">Reorder</th>
                            <th className="py-1 pr-2">Delete</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.length === 0 ? (
                            <tr><td colSpan={7} className="py-2" style={{ color: "var(--muted)" }}>No sets yet.</td></tr>
                          ) : rows.map((r, i) => (
                            <tr key={r.id} className="border-t border-white/10">
                              <td className="py-1 pr-2">{r.set_number}</td>
                              <td className="py-1 pr-2">
                                <NumberField
                                  className="w-24"
                                  value={r.target_reps}
                                  onChange={(n) => updateSet(r, { target_reps: n })}
                                  placeholder="reps"
                                  min={0}
                                />
                              </td>
                              <td className="py-1 pr-2">
                                <NumberField
                                  className="w-28"
                                  value={r.target_weight_kg}
                                  onChange={(n) => updateSet(r, { target_weight_kg: n })}
                                  placeholder="kg"
                                  step={0.5}
                                  min={0}
                                />
                              </td>
                              <td className="py-1 pr-2">
                                <NumberField
                                  className="w-24"
                                  value={r.target_percent_rm}
                                  onChange={(n) => updateSet(r, { target_percent_rm: n })}
                                  placeholder="%"
                                  step={1}
                                  min={0} max={100}
                                />
                              </td>
                              <td className="py-1 pr-2">
                                <NumberField
                                  className="w-24"
                                  value={r.target_rpe}
                                  onChange={(n) => updateSet(r, { target_rpe: n })}
                                  placeholder="RPE"
                                  step={0.5}
                                  min={1} max={10}
                                />
                              </td>
                              <td className="py-1 pr-2">
                                <div className="flex items-center gap-1">
                                  <button className="btn btn-dark" onClick={() => moveSet(r, "up")} disabled={i === 0}>↑</button>
                                  <button className="btn btn-dark" onClick={() => moveSet(r, "down")} disabled={i === rows.length - 1}>↓</button>
                                </div>
                              </td>
                              <td className="py-1 pr-2">
                                <button className="btn btn-dark" onClick={() => deleteSet(r)}>Delete</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Optional named export too (lets callers import either style)
export { CoachAuthorEditor };
