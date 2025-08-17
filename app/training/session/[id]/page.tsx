"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import * as Supa from "@/lib/supabaseClient";
import { CheckCircle2 } from "lucide-react";
import { errMsg } from "@/lib/err";

type PlanItem = {
  id: string;
  user_id: string;
  session_date: string;
  title: string;
  details: any | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

function fromYMD(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

export default function AthleteSessionPage() {
  const router = useRouter();
  const params = useParams() as { id?: string };
  const sessionId = params?.id || "";

  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [item, setItem] = useState<PlanItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  const [duration, setDuration] = useState<string>("");
  const [rpe, setRpe] = useState<string>("");

  const builderDataRef = useRef<any>(null);

  const loadItem = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setNote("");
    try {
      const { data, error } = await supabase.from("training_plan_items").select("*").eq("id", sessionId).single();
      if (error) throw error;
      setItem(data as PlanItem);
      setDuration(data?.duration_min != null ? String(data.duration_min) : "");
      setRpe(data?.rpe != null ? String(data.rpe) : "");
      builderDataRef.current = data?.details ?? null;
    } catch (e) {
      console.error("[session] loadItem error:", e);
      setNote(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, sessionId]);

  useEffect(() => { loadItem(); }, [loadItem]);

  async function markCompleted() {
    if (!supabase || !item) return;
    setNote("");
    try {
      const d = duration.trim() ? Number(duration.trim()) : null;
      const r = rpe.trim() ? Number(rpe.trim()) : null;
      const { error } = await supabase
        .from("training_plan_items")
        .update({ status: "completed", duration_min: d, rpe: r })
        .eq("id", item.id);
      if (error) throw error;
      setItem(prev => prev ? { ...prev, status: "completed", duration_min: d, rpe: r } : prev);
    } catch (e) {
      console.error("[session] markCompleted error:", e);
      setNote(errMsg(e));
    }
  }

  function renderBlocks() {
    const d = builderDataRef.current;
    const blocks: any[] = d?.blocks || [];
    if (!blocks.length) return <div className="text-sm opacity-70">No structured details. Check the title & notes only.</div>;

    return (
      <div className="space-y-3">
        {blocks.map((b, i) => (
          <div key={b.id || i} className="rounded border border-white/10 p-3">
            <div className="font-semibold">{b.title || (b.type === "strength" ? "Strength" : "Endurance")}</div>

            {b.type === "endurance_intervals" && Array.isArray(b.intervals) ? (
              <div className="mt-2 space-y-1 text-sm">
                {b.intervals.map((row: any, idx: number) => (
                  <div key={row.id || idx} className="rounded bg-white/5 px-2 py-1">
                    <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
                      <div className="font-medium">{row.name || `Interval ${idx + 1}`}</div>
                      <div className="ml-auto opacity-70">
                        {row.workSec ?? 0}s / {row.restSec ?? 0}s × {row.reps ?? 1}
                      </div>
                    </div>
                    {row.note ? <div className="text-xs opacity-80 mt-1">{row.note}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {b.type === "strength" && Array.isArray(b.exercises) ? (
              <div className="mt-2 space-y-1 text-sm">
                {b.exercises.map((ex: any, idx: number) => (
                  <div key={ex.id || idx} className="rounded bg-white/5 px-2 py-1">
                    <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
                      <div className="font-medium">{ex.name || `Exercise ${idx + 1}`}</div>
                      <div className="ml-auto opacity-70">
                        {ex.sets ?? 0} × {ex.reps ?? "—"}{ex.rpe ? ` @ RPE ${ex.rpe}` : ""}
                      </div>
                    </div>
                    {ex.notes ? <div className="text-xs opacity-80 mt-1">{ex.notes}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-20">
      <NavBar />

      <div className="mt-6 card p-4">
        <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
          <Link href="/training" className="btn">← Back</Link>
          <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>
            {item?.session_date ? fromYMD(item.session_date).toLocaleDateString() : ""}
          </div>
        </div>

        {loading ? (
          <div className="mt-3">Loading…</div>
        ) : !item ? (
          <div className="mt-3 text-red-400 text-sm">{note || "Session not found."}</div>
        ) : (
          <div className="mt-3 space-y-4">
            <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
              <h1 className="text-xl font-semibold">{item.title}</h1>
              <span className="text-xs ml-2 px-2 py-[2px] rounded bg-white/10" style={{ color: "var(--muted)" }}>
                {item.status}
              </span>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs" style={{ color: "var(--muted)" }}>Duration (min)</div>
                <input
                  className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                  inputMode="numeric"
                  value={duration}
                  onChange={e => setDuration(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="60"
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs" style={{ color: "var(--muted)" }}>RPE (1–10)</div>
                <input
                  className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                  inputMode="numeric"
                  value={rpe}
                  onChange={e => setRpe(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="7"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
             <Link className="btn" href={`/training/timer/${sessionId}`}>
  Start Workout
</Link>

              <button className="btn btn-dark" onClick={markCompleted}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> Mark Completed
              </button>
              {note ? <span className="text-xs" style={{ color: "#fca5a5" }}>{note}</span> : null}
            </div>

            <div className="pt-2">
              <div className="text-sm font-semibold">Plan</div>
              <div className="mt-2">{renderBlocks()}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
