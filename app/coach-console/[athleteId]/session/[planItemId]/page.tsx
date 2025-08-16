// app/coach-console/[athleteId]/session/[planItemId]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import EnduranceEditor from "@/components/EnduranceEditor";
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
};

export default function CoachSessionAuthorPage() {
  const { athleteId, planItemId } = useParams<{ athleteId: string; planItemId: string }>();

  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [item, setItem] = useState<PlanItem | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) return;
    try {
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("id", planItemId)
        .single();
      if (error) throw error;
      setItem(data as PlanItem);
    } catch (e:any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase, planItemId]);

  useEffect(() => { load(); }, [load]);

  async function updateField(patch: Partial<PlanItem>) {
    if (!isConfigured || !supabase || !item) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("training_plan_items")
        .update(patch)
        .eq("id", item.id);
      if (error) throw error;
      setItem({ ...item, ...patch });
    } catch (e:any) {
      setNote(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto pb-16">
      <NavBar />
      <div className="card p-4 mt-6">
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <Link className="btn" href={`/coach-console/${athleteId}`}>← Back to week</Link>
          <h1 className="text-xl font-semibold">Edit Session</h1>
          <span className="ml-auto text-sm" style={{ color: "var(--muted)" }}>
            {saving ? "Saving…" : "Saved"}
          </span>
        </div>
        {note ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div> : null}
      </div>

      {!item ? (
        <div className="card p-4 mt-4">Loading…</div>
      ) : (
        <>
          {/* Metadata editor */}
          <div className="card p-4 mt-4">
            <h3 className="font-semibold">Session Details</h3>
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              <div className="grid gap-2">
                <label className="text-sm" style={{ color: "var(--muted)" }}>Date</label>
                <input
                  type="date"
                  className="px-3 py-2 rounded bg-white/5 border border-white/10"
                  value={item.session_date}
                  onChange={(e) => updateField({ session_date: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm" style={{ color: "var(--muted)" }}>Sport</label>
                <select
                  className="px-3 py-2 rounded bg-white/5 border border-white/10"
                  value={item.sport}
                  onChange={(e) => updateField({ sport: e.target.value as Sport })}
                >
                  <option value="climbing">Climbing</option>
                  <option value="ski">Ski</option>
                  <option value="mtb">MTB</option>
                  <option value="running">Running</option>
                </select>
              </div>
            </div>

            <div className="grid gap-2 mt-3">
              <label className="text-sm" style={{ color: "var(--muted)" }}>Title</label>
              <input
                className="px-3 py-2 rounded bg-white/5 border border-white/10"
                placeholder="Session title"
                value={item.title || ""}
                onChange={(e) => updateField({ title: e.target.value })}
              />
            </div>

            <div className="grid gap-2 mt-3">
              <label className="text-sm" style={{ color: "var(--muted)" }}>Description</label>
              <textarea
                rows={4}
                className="px-3 py-2 rounded bg-white/5 border border-white/10"
                placeholder="Describe the session goals, cues, etc."
                value={item.details ?? ""}
                onChange={(e) => updateField({ details: e.target.value })}
              />
            </div>
          </div>

          {/* Structured content */}
          {(item.sport === "running" || item.sport === "mtb" || item.sport === "ski") ? (
            <div className="card p-4 mt-4">
              <h3 className="font-semibold">Intervals</h3>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Add warm-up, work blocks, recoveries, cool-down. Saves automatically.
              </p>
              <div className="mt-3">
                <EnduranceEditor planItemId={item.id} athleteId={item.user_id} />
              </div>
            </div>
          ) : (
            <div className="card p-4 mt-4">
              <h3 className="font-semibold">Strength / Climbing Builder</h3>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Coming next: exercise blocks, supersets, %1RM/RPE, recommended loads, and demo videos.
              </p>
              {/* Hook in your resistance builder component here when ready */}
            </div>
          )}
        </>
      )}
    </div>
  );
}
