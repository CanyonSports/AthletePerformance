// components/EnduranceEditor.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";

type Interval = {
  id: string;
  user_id: string;
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

function secondsToHMS(s: number | null) {
  if (!s || s <= 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function HMSToSeconds(str: string) {
  const parts = str.trim().split(":").map(x => Number(x));
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

export default function EnduranceEditor({
  planItemId,
  athleteId,
}: {
  planItemId: string;
  athleteId: string;
}) {
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Interval[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!isConfigured || !supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("training_intervals")
        .select("*")
        .eq("plan_item_id", planItemId)
        .order("block", { ascending: true })
        .order("order_index", { ascending: true });
      if (error) throw error;
      setRows((data || []) as Interval[]);
    } catch (e:any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [planItemId]);

  async function addRow(block: Interval["block"]) {
    if (!isConfigured || !supabase) return;
    setNote("");
    try {
      const oi = (rows.filter(r => r.block === block).slice(-1)[0]?.order_index ?? 0) + 10;
      const { data, error } = await supabase
        .from("training_intervals")
        .insert({
          user_id: athleteId,
          plan_item_id: planItemId,
          block,
          order_index: oi,
          repeats: 1,
          mode: "duration",
          duration_sec: 300,
          distance_m: null,
          target_type: "rpe",
          target_low: 5,
          target_high: 6,
          notes: null,
        })
        .select("*")
        .single();
      if (error) throw error;
      setRows(prev => [...prev, data as Interval].sort(sorter));
    } catch (e:any) {
      setNote(e.message ?? String(e));
    }
  }

  function sorter(a: Interval, b: Interval) {
    const blockOrder = (blk: Interval["block"]) => (blk === "warmup" ? 0 : blk === "main" ? 1 : 2);
    const bo = blockOrder(a.block) - blockOrder(b.block);
    if (bo !== 0) return bo;
    return a.order_index - b.order_index;
  }

  async function patch(id: string, delta: Partial<Interval>) {
    if (!isConfigured || !supabase) return;
    setNote("");
    try {
      const { error } = await supabase.from("training_intervals").update(delta).eq("id", id);
      if (error) throw error;
      setRows(prev => prev.map(r => (r.id === id ? { ...r, ...delta } as Interval : r)).sort(sorter));
    } catch (e:any) {
      setNote(e.message ?? String(e));
    }
  }

  async function remove(id: string) {
    if (!isConfigured || !supabase) return;
    if (!confirm("Delete interval?")) return;
    try {
      const { error } = await supabase.from("training_intervals").delete().eq("id", id);
      if (error) throw error;
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e:any) {
      setNote(e.message ?? String(e));
    }
  }

  function Block({ block }: { block: Interval["block"] }) {
    const list = rows.filter(r => r.block === block);
    const label = block === "warmup" ? "Warm-up" : block === "main" ? "Main" : "Cool-down";
    return (
      <div className="rounded border border-white/10 p-3">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold">{label}</h4>
          <button className="btn btn-dark ml-auto" onClick={() => addRow(block)}>+ Interval</button>
        </div>

        {list.length === 0 ? (
          <div className="text-sm opacity-70 mt-2">No intervals in this block.</div>
        ) : (
          <div className="mt-2 space-y-2">
            {list.map(r => (
              <div key={r.id} className="rounded bg-white/5 p-2">
                <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
                  <input
                    className="w-20 field"
                    type="number"
                    min={1}
                    value={r.repeats}
                    onChange={e => patch(r.id, { repeats: Math.max(1, Number(e.target.value || 1)) })}
                    title="Repeats"
                  />
                  <select
                    className="field"
                    value={r.mode}
                    onChange={e => patch(r.id, { mode: e.target.value as any })}
                  >
                    <option value="duration">By duration</option>
                    <option value="distance">By distance</option>
                  </select>

                  {r.mode === "duration" ? (
                    <input
                      className="w-24 field"
                      value={secondsToHMS(r.duration_sec ?? 0)}
                      onChange={e => patch(r.id, { duration_sec: HMSToSeconds(e.target.value) })}
                      placeholder="mm:ss or h:mm:ss"
                      title="Duration"
                    />
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        className="w-24 field"
                        type="number"
                        min={0}
                        value={(r.distance_m ?? 0) / 1000}
                        onChange={e => patch(r.id, { distance_m: Math.max(0, Number(e.target.value || 0)) * 1000 })}
                        placeholder="km"
                        title="Distance (km)"
                      />
                      <span className="text-xs opacity-70">km</span>
                    </div>
                  )}

                  <select
                    className="field"
                    value={r.target_type}
                    onChange={e => patch(r.id, { target_type: e.target.value as any })}
                  >
                    <option value="rpe">RPE</option>
                    <option value="pace">Pace</option>
                    <option value="hr">HR</option>
                    <option value="power">Power</option>
                  </select>

                  <input
                    className="w-20 field"
                    type="number"
                    value={r.target_low ?? 0}
                    onChange={e => patch(r.id, { target_low: Number(e.target.value || 0) })}
                    placeholder="low"
                    title="Target low"
                  />
                  <span className="opacity-60">–</span>
                  <input
                    className="w-20 field"
                    type="number"
                    value={r.target_high ?? 0}
                    onChange={e => patch(r.id, { target_high: Number(e.target.value || 0) })}
                    placeholder="high"
                    title="Target high"
                  />

                  <button className="btn ml-auto" onClick={() => remove(r.id)}>Delete</button>
                </div>

                <textarea
                  className="w-full field mt-2"
                  rows={2}
                  placeholder="Notes"
                  value={r.notes ?? ""}
                  onChange={e => patch(r.id, { notes: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Endurance Intervals</h3>
        {note ? <span className="text-xs" style={{color:"#fca5a5"}}>{note}</span> : null}
      </div>
      {loading ? <div className="mt-2">Loading…</div> : (
        <div className="grid grid-3 mt-3">
          <Block block="warmup" />
          <Block block="main" />
          <Block block="cooldown" />
        </div>
      )}
    </div>
  );
}
