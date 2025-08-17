// components/ProgramBuilder.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as Supa from "@/lib/supabaseClient";
import EnduranceEditor from "@/components/EnduranceEditor";

/** Minimal shape of your plan item row */
type PlanItem = {
  id: string;
  user_id: string;
  session_date: string; // yyyy-mm-dd
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromYMD(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

type Props = {
  athleteId: string;
  /** Use "new" to create a brand-new session then auto-route to its id */
  planItemId: string; // id | "new"
  initialDate?: string; // optional when planItemId === "new"
};

export default function ProgramBuilder({ athleteId, planItemId, initialDate }: Props) {
  const router = useRouter();

  // Supabase: works with either getSupabase() or exported supabase
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [item, setItem] = useState<PlanItem | null>(null);
  const [status, setStatus] = useState<string>("");
  const [fatal, setFatal] = useState<string>("");

  const loadItem = useCallback(async (id: string) => {
    if (!supabase) return;
    setStatus("Loading…");
    try {
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("id", id)
        .eq("user_id", athleteId)
        .single();
      if (error) throw error;
      setItem(data as PlanItem);
      setStatus("");
    } catch (e:any) {
      setStatus("");
      setFatal(e.message ?? String(e));
    }
  }, [supabase, athleteId]);

  // Create on the fly if planItemId === "new"
  useEffect(() => {
    (async () => {
      if (!supabase) { setFatal("Supabase not configured."); return; }
      if (planItemId !== "new") {
        loadItem(planItemId);
        return;
      }
      try {
        setStatus("Creating session…");
        const { data, error } = await supabase
          .from("training_plan_items")
          .insert({
            user_id: athleteId,
            session_date: initialDate || ymd(),
            title: "New Session",
            details: "",
            duration_min: null,
            rpe: null,
            status: "planned",
          })
          .select("*")
          .single();
        if (error) throw error;
        // Redirect to the real id route so refresh works nicely
        router.replace(`/coach-console/${athleteId}/session/${data.id}/edit`);
        setItem(data as PlanItem);
        setStatus("");
      } catch (e:any) {
        setStatus("");
        setFatal(e.message ?? String(e));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, planItemId, athleteId, initialDate]);

  async function patch(patch: Partial<PlanItem>) {
    if (!supabase || !item) return;
    const prev = item;
    setItem({ ...item, ...patch });
    setStatus("Saving…");
    const { error } = await supabase
      .from("training_plan_items")
      .update(patch)
      .eq("id", prev.id);
    setStatus(error ? (error.message ?? String(error)) : "Saved");
    if (error) setItem(prev); // revert on failure
    // Clear "Saved" after a moment
    if (!error) setTimeout(() => setStatus(""), 700);
  }

  async function del() {
    if (!supabase || !item) return;
    if (!confirm("Delete this session? This cannot be undone.")) return;
    setStatus("Deleting…");
    const { error } = await supabase.from("training_plan_items").delete().eq("id", item.id);
    if (error) { setStatus(error.message ?? String(error)); return; }
    router.push(`/coach-console/${athleteId}`);
  }

  if (fatal) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="card p-4">
          <p className="text-red-400 text-sm">{fatal}</p>
          <Link href={`/coach-console/${athleteId}`} className="btn mt-3">← Back</Link>
        </div>
      </div>
    );
  }
  if (!item) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="card p-4">Loading…</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-24">
      {/* Sticky header */}
      <div className="card p-4" style={{ position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(6px)", background: "rgba(0,0,0,0.6)" }}>
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <Link href={`/coach-console/${athleteId}`} className="btn">← Back</Link>
          <h1 className="text-xl font-semibold">Session Composer</h1>
          <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>{status}</div>
        </div>
        <div className="mt-3 grid" style={{ gap: 8, gridTemplateColumns: "1fr 180px 140px" }}>
          <input
            className="px-3 py-2 rounded bg-white/5 border border-white/10"
            placeholder="Session title"
            value={item.title || ""}
            onChange={(e) => patch({ title: e.target.value })}
          />
          <input
            type="date"
            className="px-3 py-2 rounded bg-white/5 border border-white/10"
            value={item.session_date}
            onChange={(e) => patch({ session_date: e.target.value })}
          />
          <div className="flex gap-2">
            <select
              className="px-3 py-2 rounded bg-white/5 border border-white/10"
              value={item.status}
              onChange={(e) => patch({ status: e.target.value as PlanItem["status"] })}
            >
              <option value="planned">Planned</option>
              <option value="completed">Completed</option>
              <option value="skipped">Skipped</option>
            </select>
            <button className="btn btn-dark" onClick={del}>Delete</button>
          </div>
        </div>
        <textarea
          className="w-full mt-3 px-3 py-2 rounded bg-white/5 border border-white/10"
          placeholder="Description / intent"
          rows={3}
          value={item.details ?? ""}
          onChange={(e) => patch({ details: e.target.value })}
        />
      </div>

      {/* Full-screen workout composer (reuses your structured editor) */}
      <div className="mt-4 card p-4">
        <h3 className="font-semibold">Workout Composer</h3>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Add exercises, set reps & load/RPE, group supersets, and attach demo links.
        </p>

        <div className="mt-3">
          <EnduranceEditor planItemId={item.id} athleteId={athleteId} />
        </div>
      </div>
    </div>
  );
}
