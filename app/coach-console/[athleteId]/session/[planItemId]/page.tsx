// app/coach-console/[athleteId]/session/[planItemId]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import * as Supa from "@/lib/supabaseClient";
import ProgramBuilder from "@/components/ProgramBuilder";

type PlanItem = {
  id: string;
  user_id: string;
  session_date: string; // yyyy-mm-dd
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  sport?: string | null;
};

function isUUID(v: string | undefined | null) {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function CoachSessionAuthorPage() {
  const params = useParams() as { athleteId?: string; planItemId?: string };
  // Decode & normalize route params
  const athleteId = params?.athleteId ? decodeURIComponent(params.athleteId) : "";
  const planItemId = params?.planItemId ? decodeURIComponent(params.planItemId) : "";
  const isNew = planItemId === "new";

  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [item, setItem] = useState<PlanItem | null>(null);
  const [loading, setLoading] = useState(!isNew);

  const load = useCallback(async () => {
    if (!isConfigured || !supabase || isNew || !isUUID(athleteId) || !planItemId) return;
    setLoading(true);
    setNote("");
    try {
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("id", planItemId)
        .eq("user_id", athleteId)
        .single();
      if (error) throw error;
      setItem(data as PlanItem);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, planItemId, isNew, athleteId]);

  useEffect(() => { load(); }, [load]);

  if (!isUUID(athleteId)) {
    return (
      <div className="max-w-6xl mx-auto pb-16">
        <div className="card p-4 mt-6">
          <h1 className="text-xl font-semibold">Build Session</h1>
          <p className="text-xs mt-2" style={{ color: "#fca5a5" }}>
            Invalid athlete id in URL. Go back and choose an athlete.
          </p>
          <Link className="btn mt-3" href="/coach-console">← Back to coach console</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <div className="card p-4 mt-6">
        <div className="flex items-center gap-2 flex-wrap">
          <Link className="btn" href={`/coach-console/${athleteId}`}>
            ← Back to week
          </Link>
          <h1 className="text-xl font-semibold">Build Session</h1>
        </div>
        {note ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div> : null}
      </div>

      <div className="card p-4 mt-4">
        <div className="flex items-baseline justify-between">
          <h3 className="font-semibold">Structured Content</h3>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Add intervals/blocks. Saves automatically.
          </p>
        </div>

        {loading ? (
          <div className="mt-4">Loading…</div>
        ) : (
          <div className="mt-3">
            <ProgramBuilder
              athleteId={athleteId}           // validated UUID
              planItemId={planItemId}         // "new" or existing id
              initialDate={item?.session_date}
              hideStatus
            />
          </div>
        )}
      </div>
    </div>
  );
}
