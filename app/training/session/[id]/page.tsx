// app/training/session/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
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
  status: "planned" | "completed" | "skipped";
};

type Exercise = {
  id: string;
  user_id: string;
  plan_item_id: string;
  name: string;
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
  exercise_id: string;
  set_number: number;
  target_reps: number | null;
  target_weight_kg: number | null;
  target_percent_rm: number | null;
  target_rpe: number | null;
  actual_reps: number | null;
  actual_weight_kg: number | null;
  completed: boolean;
};

function ytEmbed(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      const id = u.searchParams.get("v") || u.pathname.replace("/", "");
      return `https://www.youtube.com/embed/${id}`;
    }
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return `https://player.vimeo.com/video/${id}`;
    }
    return null;
  } catch { return null; }
}

export default function SessionDetailPage(){
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [session, setSession] = useState<PlanItem | null>(null);
  const [exs, setExs] = useState<Exercise[]>([]);
  const [setsMap, setSetsMap] = useState<Record<string, SetRow[]>>({});
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) return;
    try {
      const sRes = await supabase.from("training_plan_items").select("*").eq("id", sessionId).single();
      if (sRes.error) throw sRes.error;
      setSession(sRes.data as PlanItem);

      const eRes = await supabase
        .from("training_exercises").select("*")
        .eq("plan_item_id", sessionId)
        .order("superset_key", { ascending: true, nullsFirst: true })
        .order("order_index", { ascending: true });
      if (eRes.error) throw eRes.error;
      const exercises = (eRes.data || []) as Exercise[];
      setExs(exercises);

      const ids = exercises.map(e => e.id);
      if (!ids.length) { setSetsMap({}); return; }
      const rRes = await supabase
        .from("training_sets").select("*")
        .in("exercise_id", ids)
        .order("exercise_id", { ascending: true })
        .order("set_number", { ascending: true });
      if (rRes.error) throw rRes.error;
      const map: Record<string, SetRow[]> = {};
      for (const r of (rRes.data || []) as SetRow[]) (map[r.exercise_id] ||= []).push(r);
      setSetsMap(map);
    } catch (e:any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase, sessionId]);

  useEffect(() => { loadAll(); }, [loadAll]);

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

  async function toggleComplete(row: SetRow) {
    await updateSet(row, { completed: !row.completed });
  }

  const allSets = useMemo(() => Object.values(setsMap).flat(), [setsMap]);
  const allDone = useMemo(() => allSets.length > 0 && allSets.every(s => s.completed), [allSets]);

  async function markWorkoutComplete() {
    if (!isConfigured || !supabase || !session) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("training_plan_items").update({ status: "completed" }).eq("id", session.id);
      if (error) throw error;
      setSession({ ...session, status: "completed" });
    } catch (e:any) {
      setNote(e.message ?? String(e));
    } finally { setSaving(false); }
  }

  // Group by superset_key for headings
  const groups = useMemo(() => {
    const g = new Map<string, Exercise[]>();
    for (const ex of exs) {
      const key = ex.superset_key ?? "";
      g.set(key, [...(g.get(key) || []), ex]);
    }
    return Array.from(g.entries()); // [ [ 'A', [ex,ex] ], [ '', [solo...] ] ]
  }, [exs]);

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <NavBar />

      {/* Header */}
      <div className="mt-6 card p-4 sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-black/50 bg-black/30">
        <div className="flex items-center gap-2">
          <Link href="/training" className="btn btn-dark">← Today</Link>
          <div className="ml-2">
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {session ? new Date(session.session_date).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "—"}
            </div>
            <h1 className="text-xl font-semibold">
              {session?.title || "Session"}
            </h1>
          </div>
          <div className="ml-auto text-sm">
            <span className="px-2 py-1 rounded bg-white/10">
              {session?.sport?.toUpperCase() ?? "—"}
            </span>
          </div>
        </div>
        {session?.details ? <p className="text-sm mt-2 opacity-80">{session.details}</p> : null}
        {note ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div> : null}
      </div>

      {/* Exercises */}
      <div className="mt-4 space-y-6">
        {groups.map(([key, list]) => (
          <div key={key || "solo"}>
            {key ? (
              <div className="text-xs mb-2 px-2 py-1 rounded bg-white/10 inline-block">
                Superset {key}
              </div>
            ) : null}

            <div className="grid gap-8">
              {list.map(ex => {
                const src = ytEmbed(ex.video_url);
                const rows = setsMap[ex.id] || [];
                return (
                  <div key={ex.id} className="card p-4">
                    <div className="flex items-start gap-4 flex-col md:flex-row">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">{ex.name || "Exercise"}</h3>
                          {ex.target_sets || ex.target_reps ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-white/10">
                              {ex.target_sets ?? "—"} x {ex.target_reps ?? "—"}
                            </span>
                          ) : null}
                          {ex.target_percent_rm ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-white/10">{ex.target_percent_rm}% 1RM</span>
                          ) : null}
                          {ex.target_rpe ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-white/10">RPE {ex.target_rpe}</span>
                          ) : null}
                          {ex.rec_weight_kg ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-white/10">{ex.rec_weight_kg} kg</span>
                          ) : null}
                        </div>
                        {ex.notes ? <p className="text-sm mt-1 opacity-80">{ex.notes}</p> : null}
                      </div>

                      {/* Inline video */}
                      <div className="w-full md:w-80 aspect-video bg-black/30 rounded overflow-hidden">
                        {src ? (
                          <iframe
                            className="w-full h-full"
                            src={src}
                            title="demo"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                          />
                        ) : ex.video_url ? (
                          <a href={ex.video_url} target="_blank" className="block p-3 text-sm underline">
                            Open demo video
                          </a>
                        ) : (
                          <div className="p-3 text-sm opacity-70">No demo video</div>
                        )}
                      </div>
                    </div>

                    {/* Sets table */}
                    <div className="mt-4 overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left" style={{ color: "var(--muted)" }}>
                            <th className="py-1 pr-2">Set</th>
                            <th className="py-1 pr-2">Target</th>
                            <th className="py-1 pr-2">Actual Reps</th>
                            <th className="py-1 pr-2">Actual kg</th>
                            <th className="py-1 pr-2">Done</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.length === 0 ? (
                            <tr><td colSpan={5} className="py-2 opacity-70">No sets</td></tr>
                          ) : rows.map(r => (
                            <tr key={r.id} className="border-t border-white/10">
                              <td className="py-2 pr-2">{r.set_number}</td>
                              <td className="py-2 pr-2 opacity-80">
                                {r.target_reps ?? "—"} reps
                                {r.target_weight_kg ? ` @ ${r.target_weight_kg} kg` : ""}
                                {r.target_percent_rm ? ` (${r.target_percent_rm}% 1RM)` : ""}
                                {r.target_rpe ? `, RPE ${r.target_rpe}` : ""}
                              </td>
                              <td className="py-2 pr-2">
                                <input
                                  className="field w-24"
                                  type="number"
                                  value={r.actual_reps ?? ""}
                                  placeholder="reps"
                                  onChange={e => updateSet(r, { actual_reps: e.target.value === "" ? null : Number(e.target.value) })}
                                />
                              </td>
                              <td className="py-2 pr-2">
                                <input
                                  className="field w-24"
                                  type="number"
                                  step={0.5}
                                  value={r.actual_weight_kg ?? ""}
                                  placeholder="kg"
                                  onChange={e => updateSet(r, { actual_weight_kg: e.target.value === "" ? null : Number(e.target.value) })}
                                />
                              </td>
                              <td className="py-2 pr-2">
                                <label className="inline-flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={r.completed}
                                    onChange={() => toggleComplete(r)}
                                  />
                                  <span className="opacity-80">Complete</span>
                                </label>
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
          </div>
        ))}
      </div>

      {/* Footer actions */}
      <div className="fixed bottom-0 left-0 right-0 backdrop-blur supports-[backdrop-filter]:bg-black/50 bg-black/30 border-t border-white/10">
        <div className="max-w-5xl mx-auto p-3 flex items-center gap-2">
          <Link href="/training" className="btn">Back</Link>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-sm opacity-80">
              {allSets.length ? `${allSets.filter(s=>s.completed).length}/${allSets.length} sets complete` : "No sets"}
            </div>
            <button className="btn btn-dark" disabled={!allDone || saving} onClick={markWorkoutComplete}>
              {saving ? "Saving…" : "Mark workout complete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
