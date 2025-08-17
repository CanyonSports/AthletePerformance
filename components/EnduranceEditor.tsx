// components/EnduranceEditor.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as Supa from "@/lib/supabaseClient";

export type Interval = {
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
  const parts = str.trim().split(":").map((x) => (x === "" ? NaN : Number(x)));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

/** Sticky-focus notes field: fully local draft + direct Supabase save (no parent state writes). */
const NotesField = React.memo(function NotesField({
  rowId,
  initial,
  saveNotes,
  ariaLabel,
}: {
  rowId: string;
  initial: string;
  saveNotes: (id: string, text: string) => Promise<void>;
  ariaLabel: string;
}) {
  const [val, setVal] = useState(initial);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  // Only reset when switching rows
  useEffect(() => { setVal(initial); }, [rowId]);
  useEffect(() => () => { isMounted.current = false; }, []);

  const flush = useCallback(async (text: string) => {
    setSaving(true);
    try { await saveNotes(rowId, text); } finally {
      // Keep tiny delay so user sees the state, but never unmounts/loses focus
      if (isMounted.current) setTimeout(() => setSaving(false), 120);
    }
  }, [rowId, saveNotes]);

  return (
    <div className="mt-2">
      <textarea
        className="w-full field"
        rows={2}
        placeholder="Notes"
        value={val}
        onChange={(e) => {
          const v = e.target.value;
          setVal(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(v), 700);
        }}
        onBlur={(e) => {
          if (timer.current) clearTimeout(timer.current);
          flush(e.target.value); // immediate on blur
        }}
        autoComplete="off"
        spellCheck
        aria-label={ariaLabel}
      />
      {saving ? <div className="text-xs opacity-70 mt-1">Saving…</div> : null}
    </div>
  );
});

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

  // Draft strings for duration/distance so text doesn’t jump
  type Draft = { durationStr?: string; distanceStr?: string };
  const [draft, setDraft] = useState<Record<string, Draft>>({});

  // Debounced patch queue for other fields (not notes)
  const pending = useRef<Record<string, Partial<Interval>>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleFlush() {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 600);
  }
  async function flush() {
    const work = pending.current;
    pending.current = {};
    if (!isConfigured || !supabase) return;
    const entries = Object.entries(work);
    if (entries.length === 0) return;
    try {
      await Promise.all(entries.map(([id, delta]) => supabase.from("training_intervals").update(delta).eq("id", id)));
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }

  const saveNotesDirect = useCallback(async (id: string, text: string) => {
    if (!isConfigured || !supabase) return;
    // Direct write; DO NOT call setRows here → avoids any parent re-render that could cost focus
    const { error } = await supabase.from("training_intervals").update({ notes: text }).eq("id", id);
    if (error) setNote(error.message);
  }, [isConfigured, supabase]);

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
      setDraft({});
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => { if (flushTimer.current) clearTimeout(flushTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planItemId]);

  function sorter(a: Interval, b: Interval) {
    const blockOrder = (blk: Interval["block"]) => (blk === "warmup" ? 0 : blk === "main" ? 1 : 2);
    const bo = blockOrder(a.block) - blockOrder(b.block);
    if (bo !== 0) return bo;
    return a.order_index - b.order_index;
  }

  // Optimistic local update + queued DB patch (non-notes)
  const updateLocal = useCallback((id: string, delta: Partial<Interval>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? ({ ...r, ...delta } as Interval) : r)).sort(sorter));
    pending.current[id] = { ...(pending.current[id] || {}), ...delta };
    scheduleFlush();
  }, []);

  async function addRow(block: Interval["block"]) {
    if (!isConfigured || !supabase) return;
    setNote("");
    try {
      const oi = (rows.filter((r) => r.block === block).slice(-1)[0]?.order_index ?? 0) + 10;
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
      setRows((prev) => [...prev, data as Interval].sort(sorter));
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }

  async function remove(id: string) {
    if (!isConfigured || !supabase) return;
    if (!confirm("Delete interval?")) return;
    try {
      setRows((prev) => prev.filter((r) => r.id !== id)); // optimistic
      delete pending.current[id];
      const { error } = await supabase.from("training_intervals").delete().eq("id", id);
      if (error) throw error;
    } catch (e: any) {
      setNote(e.message ?? String(e));
      load(); // revert
    }
  }

  function targetLabel(r: Interval) {
    const lo = r.target_low ?? 0;
    const hi = r.target_high ?? 0;
    switch (r.target_type) {
      case "rpe":   return `RPE ${lo}${hi ? `–${hi}` : ""}`;
      case "hr":    return `${lo}${hi ? `–${hi}` : ""} bpm`;
      case "power": return `${lo}${hi ? `–${hi}` : ""} W`;
      case "pace":  return `${lo}${hi ? `–${hi}` : ""} pace`;
      default:      return "";
    }
  }

  function Block({ block }: { block: Interval["block"] }) {
    const list = rows.filter((r) => r.block === block);
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
            {list.map((r, idx) => {
              const d = draft[r.id] || {};
              const durationDisplay = d.durationStr ?? secondsToHMS(r.duration_sec ?? 0);
              const distanceDisplay = d.distanceStr ?? String((r.distance_m ?? 0) / 1000);

              return (
                <div key={r.id} className="rounded bg-white/5 p-2">
                  <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
                    {/* Repeats */}
                    <input
                      className="w-20 field"
                      type="number"
                      min={1}
                      value={r.repeats}
                      onChange={(e) => updateLocal(r.id, { repeats: Math.max(1, Number(e.target.value || 1)) })}
                      title="Repeats"
                    />

                    {/* Mode */}
                    <select
                      className="field"
                      value={r.mode}
                      onChange={(e) => updateLocal(r.id, { mode: e.target.value as any })}
                    >
                      <option value="duration">By duration</option>
                      <option value="distance">By distance</option>
                    </select>

                    {/* Duration / Distance (drafted) */}
                    {r.mode === "duration" ? (
                      <input
                        className="w-24 field"
                        value={durationDisplay}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), durationStr: e.target.value } }))
                        }
                        onBlur={(e) => {
                          const sec = HMSToSeconds(e.target.value);
                          setDraft((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), durationStr: undefined } }));
                          updateLocal(r.id, { duration_sec: sec, distance_m: null });
                        }}
                        placeholder="mm:ss or h:mm:ss"
                        title="Duration"
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <input
                          className="w-24 field"
                          value={distanceDisplay}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [r.id]: { ...(prev[r.id] || {}), distanceStr: e.target.value.replace(/[^0-9.]/g, "") },
                            }))
                          }
                          onBlur={(e) => {
                            const km = Number(e.target.value || 0);
                            setDraft((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), distanceStr: undefined } }));
                            updateLocal(r.id, { distance_m: Math.max(0, km) * 1000, duration_sec: null });
                          }}
                          placeholder="km"
                          title="Distance (km)"
                          inputMode="decimal"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <span className="text-xs opacity-70">km</span>
                      </div>
                    )}

                    {/* Target type */}
                    <select
                      className="field"
                      value={r.target_type}
                      onChange={(e) => updateLocal(r.id, { target_type: e.target.value as any })}
                    >
                      <option value="rpe">RPE</option>
                      <option value="pace">Pace</option>
                      <option value="hr">HR</option>
                      <option value="power">Power</option>
                    </select>

                    {/* Target range */}
                    <input
                      className="w-20 field"
                      type="number"
                      value={r.target_low ?? 0}
                      onChange={(e) => updateLocal(r.id, { target_low: Number(e.target.value || 0) })}
                      placeholder="low"
                      title="Target low"
                    />
                    <span className="opacity-60">–</span>
                    <input
                      className="w-20 field"
                      type="number"
                      value={r.target_high ?? 0}
                      onChange={(e) => updateLocal(r.id, { target_high: Number(e.target.value || 0) })}
                      placeholder="high"
                      title="Target high"
                    />

                    <button className="btn ml-auto" onClick={() => remove(r.id)}>Delete</button>
                  </div>

                  {/* Notes — fully isolated so focus never drops */}
                  <NotesField
                    rowId={r.id}
                    initial={r.notes ?? ""}
                    saveNotes={saveNotesDirect}
                    ariaLabel={`Notes for interval ${idx + 1}`}
                  />

                  {/* Live preview */}
                  <div className="mt-2">
                    <button className="btn w-full" type="button">
                      {r.repeats}× {r.mode === "duration" ? durationDisplay : `${distanceDisplay} km`} @ {targetLabel(r)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Endurance Intervals</h3>
        {note ? <span className="text-xs" style={{ color: "#fca5a5" }}>{note}</span> : null}
      </div>
      {loading ? (
        <div className="mt-2">Loading…</div>
      ) : (
        <div className="grid grid-3 mt-3">
          <Block block="warmup" />
          <Block block="main" />
          <Block block="cooldown" />
        </div>
      )}
    </div>
  );
}
