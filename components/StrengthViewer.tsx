// components/StrengthViewer.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";
import Link from "next/link";

type Block = { id:string; plan_item_id:string; title:string; notes:string|null; order_index:number };
type Exercise = { id:string; block_id:string; name:string; demo_url:string|null; group_label:string|null; order_index:number };
type SetRow = { id:string; exercise_id:string; set_index:number; target_reps:number|null; target_load_kg:number|null; target_rpe:number|null; target_percent_rm:number|null; rest_seconds:number|null; notes:string|null };
type LogRow = { id:string; set_id:string; user_id:string; completed:boolean; actual_reps:number|null; actual_load_kg:number|null };

export default function StrengthViewer({ planItemId, athleteId }:{ planItemId:string; athleteId:string }) {
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [sets, setSets] = useState<SetRow[]>([]);
  const [logs, setLogs] = useState<Record<string, LogRow>>({}); // by set_id
  const [status, setStatus] = useState("");

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      setStatus("Loading…");
      const b = await supabase.from("strength_blocks").select("*").eq("plan_item_id", planItemId).order("order_index");
      const e = await supabase.from("strength_exercises").select("*").in("block_id", (b.data||[]).map((x: { id: any; })=>x.id)).order("order_index");
      const s = await supabase.from("strength_sets").select("*").in("exercise_id", (e.data||[]).map((x: { id: any; })=>x.id)).order("set_index");
      const lg = await supabase.from("strength_set_logs").select("*").eq("user_id", athleteId).in("set_id", (s.data||[]).map((x: { id: any; })=>x.id));
      setBlocks((b.data||[]) as any);
      setExercises((e.data||[]) as any);
      setSets((s.data||[]) as any);
      const map: Record<string, LogRow> = {};
      (lg.data||[]).forEach((r:any)=>{ map[r.set_id] = r; });
      setLogs(map);
      setStatus("");
    })();
  }, [supabase, planItemId, athleteId]);

  async function toggleComplete(setId: string) {
    if (!supabase) return;
    const existing = logs[setId];
    if (existing) {
      const { data, error } = await supabase
        .from("strength_set_logs")
        .update({ completed: !existing.completed })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (!error && data) setLogs(prev => ({ ...prev, [setId]: data as any }));
    } else {
      const { data, error } = await supabase
        .from("strength_set_logs")
        .insert({ set_id: setId, user_id: athleteId, completed: true })
        .select("*")
        .single();
      if (!error && data) setLogs(prev => ({ ...prev, [setId]: data as any }));
    }
  }

  async function updateActual(setId: string, patch: Partial<LogRow>) {
    if (!supabase) return;
    const existing = logs[setId];
    if (existing) {
      const { data } = await supabase.from("strength_set_logs").update(patch).eq("id", existing.id).select("*").single();
      if (data) setLogs(prev => ({ ...prev, [setId]: data as any }));
    } else {
      const { data } = await supabase.from("strength_set_logs").insert({ set_id: setId, user_id: athleteId, ...patch }).select("*").single();
      if (data) setLogs(prev => ({ ...prev, [setId]: data as any }));
    }
  }

  const getBlockExercises = (blockId:string) => exercises.filter(e=>e.block_id===blockId).sort((a,b)=>a.order_index-b.order_index);
  const getExerciseSets = (exerciseId:string) => sets.filter(s=>s.exercise_id===exerciseId).sort((a,b)=>a.set_index-b.set_index);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Strength Session</h3>
        <span className="ml-auto text-sm" style={{ color: "var(--muted)" }}>{status}</span>
      </div>

      <div className="mt-3 space-y-4">
        {blocks.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>No strength work programmed.</div>
        ) : blocks.sort((a,b)=>a.order_index-b.order_index).map(b => (
          <div key={b.id} className="card p-3">
            <div className="flex items-center gap-2">
              <div className="font-semibold">{b.title}</div>
              {b.notes ? <div className="text-sm" style={{ color: "var(--muted)" }}>{b.notes}</div> : null}
            </div>

            <div className="mt-2 space-y-3">
              {getBlockExercises(b.id).map(ex => (
                <div key={ex.id} className="card p-3">
                  <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
                    {ex.group_label ? <span className="badge">{ex.group_label}</span> : null}
                    <div className="font-semibold">{ex.name}</div>
                    {ex.demo_url ? <Link className="btn" href={ex.demo_url} target="_blank">Demo</Link> : null}
                  </div>

                  <div className="mt-2" style={{overflowX:"auto"}}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ color: "var(--muted)" }}>
                          <th className="text-left">Set</th>
                          <th className="text-left">Target</th>
                          <th className="text-left">Load</th>
                          <th className="text-left">RPE/%RM</th>
                          <th className="text-left">Rest</th>
                          <th className="text-left">Done</th>
                          <th className="text-left">Actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getExerciseSets(ex.id).map(s => {
                          const log = logs[s.id];
                          return (
                            <tr key={s.id}>
                              <td>{s.set_index}</td>
                              <td>{s.target_reps ?? "-"} reps</td>
                              <td>{s.target_load_kg ?? "-"} kg</td>
                              <td>{s.target_rpe ?? (s.target_percent_rm ? `${s.target_percent_rm}%` : "-")}</td>
                              <td>{s.rest_seconds ?? "-"} s</td>
                              <td>
                                <input type="checkbox" checked={!!log?.completed} onChange={() => toggleComplete(s.id)} />
                              </td>
                              <td>
                                <div className="flex gap-2">
                                  <input
                                    type="number"
                                    className="w-24 px-2 py-1 rounded bg-white/5 border border-white/10"
                                    placeholder="Reps"
                                    value={log?.actual_reps ?? ""}
                                    onChange={e => updateActual(s.id, { actual_reps: e.target.value==="" ? null : Number(e.target.value) })}
                                  />
                                  <input
                                    type="number"
                                    className="w-28 px-2 py-1 rounded bg-white/5 border border-white/10"
                                    placeholder="Load (kg)"
                                    value={log?.actual_load_kg ?? ""}
                                    onChange={e => updateActual(s.id, { actual_load_kg: e.target.value==="" ? null : Number(e.target.value) })}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
