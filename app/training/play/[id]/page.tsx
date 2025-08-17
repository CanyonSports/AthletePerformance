// app/training/play/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import * as Supa from "@/lib/supabaseClient";
import { CheckCircle2, SkipForward, Timer } from "lucide-react";

import AthleteStrengthBlock from "@/components/AthleteStrengthBlock";
import AthleteEnduranceBlock from "@/components/AthleteEnduranceBlock";

// Keep types minimal for this page
type PlanItem = {
  id: string;
  user_id: string;
  session_date: string | null;
  title: string | null;
  status: "planned" | "completed" | "skipped";
  duration_min: number | null;
  rpe: number | null;
};

export default function PlayWorkoutPage() {
  const params = useParams() as { id?: string };
  const id = params?.id || "";

  // Supabase client
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try {
      if (typeof anyS.getSupabase === "function") return anyS.getSupabase();
    } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [userId, setUserId] = useState<string | null>(null);
  const [item, setItem] = useState<PlanItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  // Load current user + plan item
  const load = useCallback(async () => {
    if (!supabase || !id) return;
    setLoading(true);
    setNote("");
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) {
        setNote("Please sign in to view this workout.");
        setLoading(false);
        return;
      }
      setUserId(u.user.id);

      const { data, error } = await supabase
        .from("training_plan_items")
        .select("id,user_id,session_date,title,status,duration_min,rpe")
        .eq("id", id)
        .single();

      if (error) throw error;
      setItem(data as PlanItem);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, id]);

  useEffect(() => { load(); }, [load]);

  async function markCompleted() {
    if (!supabase || !item) return;
    setNote("");
    try {
      const { error } = await supabase
        .from("training_plan_items")
        .update({ status: "completed" })
        .eq("id", item.id);
      if (error) throw error;
      setItem((prev) => (prev ? { ...prev, status: "completed" } as PlanItem : prev));
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }

  async function markSkipped() {
    if (!supabase || !item) return;
    setNote("");
    try {
      const { error } = await supabase
        .from("training_plan_items")
        .update({ status: "skipped" })
        .eq("id", item.id);
      if (error) throw error;
      setItem((prev) => (prev ? { ...prev, status: "skipped" } as PlanItem : prev));
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }

  return (
    <div className="max-w-3xl mx-auto pb-28">
      <NavBar />

      <div
        className="mt-4 rounded-2xl p-4 md:p-5"
        style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}
      >
        {/* Header */}
        <div className="flex items-start gap-2 flex-wrap">
          <Link className="btn" href={`/training/session/${encodeURIComponent(id)}`}>
            ← Back to Overview
          </Link>
          <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>
            {item?.session_date
              ? new Date(item.session_date).toLocaleDateString()
              : ""}
          </div>
        </div>

        {/* Title & quick actions */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <h1 className="text-xl md:text-2xl font-semibold">
            {item?.title || "Training Session"}
          </h1>
          <Link
            className="btn btn-dark ml-auto"
            href={`/training/timer/${encodeURIComponent(id)}`}
            title="Open session timer"
          >
            <Timer className="w-4 h-4 mr-1" /> Timer
          </Link>
        </div>

        {/* Body */}
        {loading ? (
          <div className="mt-4">Loading workout…</div>
        ) : note ? (
          <div className="mt-4 text-sm" style={{ color: "#fca5a5" }}>
            {note}
          </div>
        ) : !item || !userId ? (
          <div className="mt-4 text-sm" style={{ color: "#fca5a5" }}>
            Couldn’t load this workout.
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {/* Strength Play UI */}
            <section>
              <h2 className="text-lg font-semibold mb-2">Strength</h2>
              <AthleteStrengthBlock planItemId={item.id} userId={userId} />
            </section>

            {/* Endurance Play UI */}
            <section>
              <h2 className="text-lg font-semibold mb-2">Endurance</h2>
              <AthleteEnduranceBlock planItemId={item.id} userId={userId} />
            </section>
          </div>
        )}
      </div>

      {/* Sticky footer actions */}
      <div
        className="fixed left-0 right-0 bottom-0"
        style={{
          background: "rgba(10,10,12,0.85)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(6px)",
        }}
      >
        <div className="max-w-3xl mx-auto px-3 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-dark" onClick={markCompleted}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Finish (Mark Completed)
            </button>
            <button className="btn btn-dark" onClick={markSkipped}>
              <SkipForward className="w-4 h-4 mr-1" /> Skip
            </button>
            <Link className="btn ml-auto" href={`/training/session/${encodeURIComponent(id)}`}>
              Back to Overview
            </Link>
            {note ? (
              <span className="text-xs ml-2" style={{ color: "#fca5a5" }}>
                {note}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
