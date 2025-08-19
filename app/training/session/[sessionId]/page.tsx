// app/training/session/[sessionId]/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import NavBar from "@/components/NavBar";
import { getSupabase } from "@/lib/supabaseClient";
import { ArrowLeft, CheckCircle2, XCircle, Circle, Trash2 } from "lucide-react";

type PlanItem = {
  id: string;
  user_id: string;
  session_date: string; // yyyy-mm-dd
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  structure?: any | null; // JSON
  created_at?: string;
};

type Exercise = {
  name: string;
  sets: number | null;
  reps: string;
  load: string;
  rest: string;
  notes: string;
};

const isUUID = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

export default function SessionPage() {
  const router = useRouter();
  const routeParams = useParams(); // ← use hook instead of props
  const rawId = routeParams?.["sessionId"];
  const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;

  const supabase = useMemo(() => { try { return getSupabase(); } catch { return null; } }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [it, setIt] = useState<PlanItem | null>(null);

  /* -------------------------- Load (guard + no .single()) -------------------------- */
  const load = useCallback(async () => {
    if (!isConfigured || !supabase) return;

    if (!isUUID(sessionId)) {
      setNote("Invalid session id.");
      setIt(null);
      return;
    }

    setLoading(true);
    setNote("");
    try {
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("id,user_id,session_date,title,details,duration_min,rpe,status,structure,created_at")
        .eq("id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;

      const row = (data && data[0]) as PlanItem | undefined;
      if (!row) {
        setNote("Session not found or access denied.");
        setIt(null);
        return;
      }
      setIt(row);
    } catch (e: any) {
      setNote(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, supabase, sessionId]);

  useEffect(() => { load(); }, [load]);

  /* -------------------------------- Actions -------------------------------- */
  const updateStatus = async (status: PlanItem["status"]) => {
    if (!isConfigured || !supabase || !it) return;
    try {
      setIt({ ...it, status });
      const { error } = await supabase.from("training_plan_items").update({ status }).eq("id", it.id);
      if (error) throw error;
    } catch (e: any) {
      setNote(e?.message || String(e));
      load();
    }
  };

  const deleteSession = async () => {
    if (!isConfigured || !supabase || !it) return;
    if (!confirm("Delete this session from your calendar?")) return;
    try {
      const { error } = await supabase.from("training_plan_items").delete().eq("id", it.id);
      if (error) throw error;
      router.push("/training/calendar");
    } catch (e: any) {
      setNote(e?.message || String(e));
    }
  };

  /* -------------------------------- Helpers -------------------------------- */
  const StatusPill: React.FC<{ status: PlanItem["status"] }> = ({ status }) => {
    const bg = status === "completed" ? "#10b98122" : status === "skipped" ? "#ef444422" : "#6b728022";
    const fg = status === "completed" ? "#10b981" : status === "skipped" ? "#ef4444" : "#9ca3af";
    const icon =
      status === "completed" ? <CheckCircle2 className="w-3 h-3" /> :
      status === "skipped"   ? <XCircle className="w-3 h-3" /> :
                               <Circle className="w-3 h-3" />;
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded" style={{ background: bg, color: fg }}>
        {icon} {status}
      </span>
    );
  };

  const renderStructure = (s: any) => {
    if (!s || typeof s !== "object") return null;
    const list: Exercise[] = Array.isArray(s.exercises) ? s.exercises : [];
    const extraNotes: string = typeof s.notes === "string" ? s.notes : "";
    if (list.length === 0 && !extraNotes) return null;

    return (
      <div className="mt-4">
        {list.length > 0 ? (
          <div className="space-y-3">
            {list.map((ex, i) => (
              <div key={i} className="rounded border bg-white/5 p-3" style={{ borderColor: "#ffffff22" }}>
                <div className="font-medium">{ex.name || `Exercise ${i + 1}`}</div>
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  {ex.sets != null ? <span>{ex.sets} sets</span> : null}
                  {ex.reps ? <span className="ml-2">{ex.reps} reps</span> : null}
                  {ex.load ? <span className="ml-2">{ex.load}</span> : null}
                  {ex.rest ? <span className="ml-2">rest {ex.rest}</span> : null}
                </div>
                {ex.notes ? <div className="text-sm opacity-90 mt-1 whitespace-pre-wrap">{ex.notes}</div> : null}
              </div>
            ))}
          </div>
        ) : null}
        {extraNotes ? (
          <div className="mt-3">
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Coach/Day Notes</div>
            <div className="text-sm opacity-90 whitespace-pre-wrap">{extraNotes}</div>
          </div>
        ) : null}
      </div>
    );
  };

  /* ---------------------------------- UI ----------------------------------- */
  return (
    <div className="max-w-4xl mx-auto pb-16">
      <NavBar />

      <div className="mt-4 rounded-2xl p-5 md:p-6" style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Link href="/training/calendar" className="btn">
              <ArrowLeft className="w-4 h-4 mr-1" /> Calendar
            </Link>
            <Link href="/training" className="btn">Week View</Link>
          </div>
          <div className="ml-auto text-xs">
            {loading ? <span style={{ color: "var(--muted)" }}>Loading…</span> : null}
            {note ? <span className="ml-2" style={{ color: "#fca5a5" }}>{note}</span> : null}
          </div>
        </div>
      </div>

      {!it ? (
        <div className="mt-6 card p-4">
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {loading ? "Loading session…" : note || "Session not found."}
          </div>
        </div>
      ) : (
        <div className="mt-6 card p-4">
          <div className="flex items-center gap-2">
            <StatusPill status={it.status} />
            <div className="ml-2">
              <h1 className="text-xl font-semibold">{it.title || "Untitled session"}</h1>
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                {new Date(it.session_date).toLocaleDateString()}
                {it.duration_min ? <> • {it.duration_min} min</> : null}
                {it.rpe ? <> • RPE {it.rpe}</> : null}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {it.status !== "completed" ? (
                <><Link className="btn btn-dark" href={`/training/session/${it.id}/start`}>
                    Start Workout
                  </Link><button className="btn" onClick={() => updateStatus("completed")}>Mark Completed</button></>
              ) : (
                <button className="btn" onClick={() => updateStatus("planned")}>Undo Complete</button>
              )}
              {it.status !== "skipped" ? (
                <button className="btn" onClick={() => updateStatus("skipped")}>Skip</button>
              ) : (
                <button className="btn" onClick={() => updateStatus("planned")}>Undo Skip</button>
              )}
              <button className="btn btn-dark" onClick={deleteSession} title="Delete session">
                <Trash2 className="w-4 h-4 mr-1" /> Delete
              </button>
            </div>
          </div>


          {it.details ? <div className="mt-3 text-sm opacity-90 whitespace-pre-wrap">{it.details}</div> : null}
          {renderStructure(it.structure)}
        </div>
      )}
    </div>
  );
}
