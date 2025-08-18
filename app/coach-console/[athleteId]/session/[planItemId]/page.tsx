// app/coach-console/session/[planItemId]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import * as Supa from "@/lib/supabaseClient";
import ProgramBuilder from "@/components/ProgramBuilder";
import CoachSessionV2 from "@/components/CoachSessionV2";

type PlanItem = {
  id: string;
  user_id: string;         // athlete id
  session_date: string;    // yyyy-mm-dd
  title: string;
  details: any | string | null;
  status: "planned" | "completed" | "skipped";
};

function isUUID(v: string | undefined | null) {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function CoachSessionByIdPage() {
  const params = useParams() as { planItemId?: string };
  const searchParams = useSearchParams();
  const planItemId = params?.planItemId ? decodeURIComponent(params.planItemId) : "";
  const useV2 = searchParams?.get("v2") === "1";

  // Supabase client (compatible with your helper or exported client)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState<PlanItem | null>(null);

  const load = useCallback(async () => {
    if (!isConfigured || !supabase || !isUUID(planItemId)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setNote("");
    try {
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("id", planItemId)
        .single();
      if (error) throw error;
      setItem(data as PlanItem);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, planItemId]);

  useEffect(() => { load(); }, [load]);

  // If the URL is wrong, help the user
  if (!isUUID(planItemId)) {
    return (
      <div className="max-w-6xl mx-auto pb-16">
        <div className="card p-4 mt-6">
          <h1 className="text-xl font-semibold">Build Session</h1>
          <p className="text-xs mt-2" style={{ color: "#fca5a5" }}>
            Invalid session id in URL.
          </p>
          <Link className="btn mt-3" href="/coach-console">← Back to Coach Console</Link>
        </div>
      </div>
    );
  }

  // Simple loading/empty states
  if (loading) {
    return (
      <div className="max-w-6xl mx-auto pb-16">
        <div className="card p-4 mt-6">Loading…</div>
      </div>
    );
  }
  if (!item) {
    return (
      <div className="max-w-6xl mx-auto pb-16">
        <div className="card p-4 mt-6">
          <h1 className="text-xl font-semibold">Build Session</h1>
          <p className="text-xs mt-2" style={{ color: "#fca5a5" }}>
            {note || "Session not found."}
          </p>
          <Link className="btn mt-3" href="/coach-console">← Back to Coach Console</Link>
        </div>
      </div>
    );
  }

  // We have the plan item — extract the athlete id
  const athleteId = item.user_id;

  // V2 shell (new UI) — toggle with ?v2=1
  if (useV2) {
    return (
      <CoachSessionV2
        athleteId={athleteId}
        planItemId={planItemId}
      />
    );
  }

  // Legacy layout (your current ProgramBuilder flow)
  return (
    <div className="max-w-6xl mx-auto pb-16">
      <div className="card p-4 mt-6">
        <div className="flex items-center gap-2 flex-wrap">
          <Link className="btn" href={`/coach-console/${athleteId}`}>
            ← Back to week
          </Link>
          <h1 className="text-xl font-semibold">Build Session</h1>
          <Link className="btn btn-dark ml-auto" href={`?v2=1`}>
            Try V2 UI
          </Link>
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

        <div className="mt-3">
          <ProgramBuilder
            athleteId={athleteId}
            planItemId={planItemId}
            initialDate={item.session_date}
            hideStatus
          />
        </div>
      </div>
    </div>
  );
}
