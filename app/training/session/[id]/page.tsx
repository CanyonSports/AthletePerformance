// app/training/session/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import * as Supa from "@/lib/supabaseClient";
import * as NavMod from "@/components/NavBar";
const NavBar: any = (NavMod as any).default ?? (NavMod as any).NavBar ?? (() => null);

type PlanItem = {
  id: string;
  user_id: string;
  sport: "climbing" | "ski" | "mtb" | "running";
  session_date: string;
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
};

type Exercise = {
  id: string;
  user_id: string;
  plan_item_id: string;
  name: string;
  exercise_key: string | null;
  superset_key: string | null;
  order_index: number;
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
  set_number: number;
  target_reps: number | null;
  target_weight_kg: number | null;
  target_rpe: number | null;
  target_percent_rm: number | null;
  actual_reps: number | null;
  actual_weight_kg: number | null;
  completed: boolean;
};

function kgToLb(kg?: number | null) { return kg == null ? null : Math.round(kg * 2.20462); }
function roundTo(x: number, step = 0.5) { return Math.round(x / step) * step; }
function isYouTube(url?: string | null) { return !!url && /youtu(\.be|be\.com)/i.test(url); }
function toEmbed(url?: string | null) {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : url;
}

export default function WorkoutDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  // Supabase client (supports either exported const or getSupabase factory)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [meId, setMeId] = useState<string | null>(null);
  const [item, setItem] = useState<PlanItem | null>(null);
  const [exs, setExs] = useState<Exercise[]>([]);
  const [sets, setSets] = useState<Record<string, SetRow[]>>({});
  const [maxes, setMaxes] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setMeId(user.id);

      // Session (ensure it belongs to the athlete)
      const { data: sRow, error: sErr } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .single();
      if (sErr) throw sErr;
      setItem(sRow as PlanItem);

      // Exercises
      const { data: eRows, error: eErr } = await supabase
        .from("training_exercises")
        .select("*")
        .eq("plan_item_id", sessionId)
        .order("superset_key", { ascending: true, nullsFirst: true })
        .order("order_index", { ascending: true });
      if (eErr) throw eErr;
      const exercises = (eRows || []) as Exercise[];
      setExs(exercises);

      // Sets
      const exIds = exercises.map(e => e.id);
      let setsMap: Record<string, SetRow[]> = {};
      if (exIds.length) {
        const { data: sRows, error: seErr } = await supabase
          .from("training_sets")
          .select("*")
          .in("exercise_id", exIds)
          .order("set_number", { ascending: true });
        if (seErr) throw seErr;
        const list = (sRows || []) as SetRow[];
        for (const r of list) (setsMap[r.exercise_id] ||= []).push(r);
      }
      setSets(setsMap);

      // 1RM maxes for recommendations
      const keys = Array.from(new Set(exercises.map(e => e.exercise_key).filter(Boolean))) as string[];
      if (keys.length) {
        const { data: mRows } = await supabase
          .from("athlete_maxes")
          .select("exercise_key, one_rm_kg")
          .eq("user_id", user.id)
          .in("exercise_key", keys);
        if (mRows) {
          const map: Record<string, number> = {};
          for (const m of mRows as any[]) map[m.exercise_key] = Number(m.one_rm_kg);
          setMaxes(map);
        }
      }
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase, router, sessionId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Realtime refresh sets/plan when they change
  useEffect(() => {
    if (!isConfigured || !supabase || !meId) return;
    let channel: any = null;
    (async () => {
      try {
        channel = supabase.channel(`sess-${sessionId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "training_sets" }, () => loadAll())
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "training_plan_items", filter: `id=eq.${sessionId}` }, () => loadAll())
          .subscribe();
      } catch {}
    })();
    return () => { try { if (channel) { supabase.removeChannel(channel); channel?.unsubscribe?.(); } } catch {} };
  }, [isConfigured, supabase, sessionId, meId, loadAll]);

  function recWeightKg(ex: Exercise): number | null {
    if (ex.rec_weight_kg != null) return ex.rec_weight_kg;
    if (ex.target_percent_rm != null && ex.exercise_key && maxes[ex.exercise_key] != null) {
      return roundTo((ex.target_percent_rm / 100) * maxes[ex.exercise_key], 0.5);
    }
    return null;
  }

  async function toggleSetDone(row: SetRow) {
    if (!isConfigured || !supabase) return;
    const next = !row.completed;
    setSets(prev => ({
      ...prev,
      [row.exercise_id]: (prev[row.exercise_id] || []).map(s => s.id === row.id ? { ...s, completed: next } : s)
    }));
    const { error } = await supabase.from("training_sets").update({ completed: next }).eq("id", row.id);
    if (error) setNote(error.message);
  }

  async function updateActual(row: SetRow, patch: Partial<SetRow>) {
    if (!isConfigured || !supabase) return;
    setSets(prev => ({
      ...prev,
      [row.exercise_id]: (prev[row.exercise_id] || []).map(s => s.id === row.id ? { ...s, ...patch } : s)
    }));
    const { error } = await supabase.from("training_sets").update(patch).eq("id", row.id);
    if (error) setNote(error.message);
  }

  async function markSessionCompleted() {
    if (!isConfigured || !supabase || !item) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("training_plan_items").update({ status: "completed" }).eq("id", item.id);
      if (error) throw error;
      setItem({ ...item, status: "completed" });
    } catch (e: any) { setNote(e.message ?? String(e)); }
    finally { setSaving(false); }
  }

  // Group exercises by superset_key
  const groups = useMemo(() => {
    const map = new Map<string, Exercise[]>();
    for (const ex of exs) {
      const key = ex.superset_key || `__solo__${ex.id}`;
      const arr = map.get(key) || [];
      arr.push(ex);
      map.set(key, arr);
    }
    return Array.from(map.entries()); // [key, Exercise[]][]
  }, [exs]);

  const title = item?.title ?? "Workout";

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <NavBar />

      <div className="card p-4 mt-6">
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <button className="btn btn-dark" type="button" onClick={() => router.push("/training")}>← Back</button>
          <h2 className="text-xl font-semibold">{title}</h2>
          {item?.sport && <span className="badge">{item.sport}</span>}
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            {item?.session_date && new Date(item.session_date).toLocaleDateString()}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-dark" type="button" disabled={saving || item?.status === "completed"} onClick={markSessionCompleted}>
              {item?.status === "completed" ? "✓ Completed" : "Mark Session Complete"}
            </button>
          </div>
        </div>
        {item?.details && (
          <div className="mt-2 text-sm whitespace-pre-wrap" style={{ color: "var(--muted)" }}>
            {item.details}
          </div>
        )}
        {note && <p className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</p>}
      </div>

      {/* Workout blocks */}
      <div className="mt-6 flex flex-col gap-4">
        {groups.length === 0 ? (
          <div className="card p-6" style={{ color: "var(--muted)" }}>
            No exercises added to this session yet.
          </div>
        ) : groups.map(([key, list], idx) => {
          const isSuperset = !key.startsWith("__solo__");
          return (
            <div key={key} className="card p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">
                  {isSuperset ? `Superset ${String.fromCharCode(65 + idx)}` : "Exercise"}
                </h3>
                {isSuperset && <span className="badge">Alternate these</span>}
              </div>

              <div className="mt-3 grid" style={{ gridTemplateColumns: `repeat(${Math.min(3, list.length)}, minmax(0,1fr))`, gap: 12 }}>
                {list.map(ex => {
                  const recKg = recWeightKg(ex);
                  const recLb = kgToLb(recKg);
                  const videoEmbed = toEmbed(ex.video_url);
                  const rows = sets[ex.id] || [];
                  return (
                    <div key={ex.id} className="rounded border border-white/10 p-3 bg-white/3">
                      <div className="flex items-center gap-2">
                        <div className="font-medium truncate">{ex.name}</div>
                        {ex.target_percent_rm != null && (
                          <span className="badge ml-auto">{ex.target_percent_rm}%1RM</span>
                        )}
                        {ex.target_rpe != null && (
                          <span className="badge ml-1">RPE {ex.target_rpe}</span>
                        )}
                      </div>
                      {ex.notes && (
                        <div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: "var(--muted)" }}>{ex.notes}</div>
                      )}

                      {/* Video */}
                      {videoEmbed ? (
                        <div className="mt-2 rounded overflow-hidden">
                          {isYouTube(ex.video_url!) ? (
                            <iframe
                              src={videoEmbed!}
                              title={`video-${ex.id}`}
                              className="w-full"
                              style={{ aspectRatio: "16 / 9", border: "0" }}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                            />
                          ) : (
                            <a className="text-sm underline" href={ex.video_url!} target="_blank" rel="noreferrer">Demo video</a>
                          )}
                        </div>
                      ) : null}

                      {/* Targets + recommendation */}
                      <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                        {ex.target_sets ? <span>{ex.target_sets} sets</span> : null}
                        {ex.target_sets && ex.target_reps ? <span> × </span> : null}
                        {ex.target_reps ? <span>{ex.target_reps} reps</span> : null}
                        {(ex.target_sets || ex.target_reps) ? <span> • </span> : null}
                        {recKg != null ? (
                          <span>Rec ~ <strong>{recKg} kg</strong>{recLb ? ` / ${recLb} lb` : ""}</span>
                        ) : (
                          <span>No weight rec</span>
                        )}
                      </div>

                      {/* Sets logging */}
                      <div className="mt-3">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left" style={{ color: "var(--muted)" }}>
                              <th className="py-1 pr-2">Set</th>
                              <th className="py-1 pr-2">Target</th>
                              <th className="py-1 pr-2">Actual</th>
                              <th className="py-1 pr-2">Done</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.length === 0 ? (
                              <tr><td colSpan={4} className="py-2" style={{ color: "var(--muted)" }}>No sets defined.</td></tr>
                            ) : rows.map(r => {
                              const targetTxt = r.target_weight_kg != null
                                ? `${r.target_reps ?? "—"} @ ${r.target_weight_kg}kg`
                                : r.target_percent_rm != null
                                  ? `${r.target_reps ?? "—"} @ ${r.target_percent_rm}%`
                                  : r.target_rpe != null
                                    ? `${r.target_reps ?? "—"} @ RPE ${r.target_rpe}`
                                    : r.target_reps != null
                                      ? `${r.target_reps} reps`
                                      : "—";
                              return (
                                <tr key={r.id} className="border-t border-white/10">
                                  <td className="py-1 pr-2">{r.set_number}</td>
                                  <td className="py-1 pr-2 text-xs" style={{ color: "var(--muted)" }}>{targetTxt}</td>
                                  <td className="py-1 pr-2">
                                    <div className="flex items-center gap-2">
                                      <input
                                        className="field w-20"
                                        type="number"
                                        min={0}
                                        placeholder="reps"
                                        value={r.actual_reps ?? ""}
                                        onChange={e => updateActual(r, { actual_reps: e.target.value === "" ? null : Number(e.target.value) })}
                                      />
                                      <input
                                        className="field w-24"
                                        type="number"
                                        min={0}
                                        step="0.5"
                                        placeholder="kg"
                                        value={r.actual_weight_kg ?? ""}
                                        onChange={e => updateActual(r, { actual_weight_kg: e.target.value === "" ? null : Number(e.target.value) })}
                                      />
                                    </div>
                                  </td>
                                  <td className="py-1 pr-2">
                                    <input
                                      type="checkbox"
                                      checked={r.completed}
                                      onChange={() => toggleSetDone(r)}
                                    />
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
