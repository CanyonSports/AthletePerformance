// components/ProgramBuilder.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as Supa from "@/lib/supabaseClient";
import EnduranceEditor from "@/components/EnduranceEditor";
import StrengthEditor from "@/components/StrengthEditor";

type PlanItem = {
  id: string;
  user_id: string;
  session_date: string;
  title: string;
  details: any | string | null;  // supports jsonb or serialized text
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  workout_type?: "endurance" | "strength" | null;
  created_at?: string;
};

type Props = {
  athleteId: string;
  planItemId: string; // "new" | UUID
  initialDate?: string;
  hideStatus?: boolean;
};

type SectionType = "endurance" | "strength";

const isSectionType = (s: unknown): s is SectionType =>
  s === "endurance" || s === "strength";

const uniqSections = (xs: SectionType[]) => Array.from(new Set(xs));

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isUUID(v: string | undefined | null) {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
function parseDetails(details: any | string | null): any {
  if (!details) return {};
  if (typeof details === "string") {
    try { return JSON.parse(details); } catch { return {}; }
  }
  if (typeof details === "object") return details;
  return {};
}

export default function ProgramBuilder({ athleteId, planItemId, initialDate, hideStatus }: Props) {
  const router = useRouter();

  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [item, setItem] = useState<PlanItem | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [fatal, setFatal] = useState<string>("");

  const [hasStrength, setHasStrength] = useState<boolean>(false);
  const [showEndurance, setShowEndurance] = useState<boolean>(false);

  // Section order (persisted in item.details.sectionOrder)
  const [sectionOrder, setSectionOrder] = useState<SectionType[]>([]);

  const loadItem = useCallback(async (id: string) => {
    if (!supabase) return;
    setStatusMsg("Loading…");
    try {
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("id", id)
        .eq("user_id", athleteId)
        .single();
      if (error) throw error;
      setItem(data as PlanItem);
      setStatusMsg("");
    } catch (e:any) {
      setStatusMsg("");
      setFatal(e.message ?? String(e));
    }
  }, [supabase, athleteId]);

  const detectStrength = useCallback(async (planId: string) => {
    if (!supabase) return;
    const { count, error } = await supabase
      .from("strength_blocks")
      .select("id", { head: true, count: "exact" })
      .eq("plan_item_id", planId);
    if (!error) setHasStrength((count ?? 0) > 0);
  }, [supabase]);

  const detectEndurance = useCallback(async (planId: string) => {
    if (!supabase) return;
    // Endurance content lives in training_intervals
    const { count, error } = await supabase
      .from("training_intervals")
      .select("id", { head: true, count: "exact" })
      .eq("plan_item_id", planId);
    if (!error) setShowEndurance((count ?? 0) > 0);
  }, [supabase]);

  // Initialize / create-new
  useEffect(() => {
    (async () => {
      if (!supabase) { setFatal("Supabase not configured."); return; }

      if (!isUUID(athleteId)) {
        setFatal("Invalid athlete id. Please go back and choose an athlete.");
        return;
      }

      if (planItemId !== "new") {
        await loadItem(planItemId);
        await detectStrength(planItemId);
        await detectEndurance(planItemId);
        return;
      }
      try {
        setStatusMsg("Creating session…");
        const { data, error } = await supabase
          .from("training_plan_items")
          .insert({
            user_id: athleteId,
            session_date: initialDate || ymd(),
            title: "New Session",
            details: null,
            duration_min: null,
            rpe: null,
            status: "planned",
          })
          .select("*")
          .single();
        if (error) throw error;

        router.replace(`/coach-console/${athleteId}/session/${data.id}`);
        setItem(data as PlanItem);
        setHasStrength(false);
        setShowEndurance(false);
        setStatusMsg("");
      } catch (e:any) {
        setStatusMsg("");
        setFatal(e.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, planItemId, athleteId, initialDate]);

  // Optimistic patch to training_plan_items
  async function patch(p: Partial<PlanItem>) {
    if (!supabase || !item) return;
    const prev = item;
    setItem({ ...item, ...p });
    setStatusMsg("Saving…");
    const { error } = await supabase.from("training_plan_items").update(p).eq("id", prev.id);
    if (error) {
      setItem(prev);
      setStatusMsg(error.message ?? String(error));
    } else {
      setStatusMsg("Saved");
      setTimeout(() => setStatusMsg(""), 700);
    }
  }

  async function del() {
    if (!supabase || !item) return;
    if (!confirm("Delete this session? This cannot be undone.")) return;
    setStatusMsg("Deleting…");
    const { error } = await supabase.from("training_plan_items").delete().eq("id", item.id);
    if (error) { setStatusMsg(error.message ?? String(error)); return; }
    router.push(`/coach-console/${athleteId}`);
  }

  // Add sections
  async function addStrengthSection() {
    if (!supabase || !item) return;
    setStatusMsg("Adding strength section…");
    const { error } = await supabase
      .from("strength_blocks")
      .insert({ plan_item_id: item.id, title: "Block A", order_index: 0 });
    if (error) { setStatusMsg(error.message ?? String(error)); return; }

    setHasStrength(true);
    setSectionOrder(prev => {
      const next = uniqSections([...prev, "strength"]);
      void persistOrder(next);
      return next;
    });

    setStatusMsg("Saved");
    setTimeout(() => setStatusMsg(""), 700);
  }

  function addEnduranceSection() {
    if (!item) return;
    setShowEndurance(true);
    setSectionOrder(prev => {
      const next = uniqSections([...prev, "endurance"]);
      void persistOrder(next);
      return next;
    });
  }

  // Remove sections
  async function removeEnduranceSection() {
    if (!supabase || !item) return;
    const ok = confirm("Remove the Endurance section? All endurance intervals for this session will be deleted.");
    if (!ok) return;
    setStatusMsg("Removing endurance…");

    const { error } = await supabase.from("training_intervals").delete().eq("plan_item_id", item.id);
    if (error) { setStatusMsg(error.message ?? String(error)); return; }

    setShowEndurance(false);
    setSectionOrder(prev => {
      const next = prev.filter(s => s !== "endurance");
      void persistOrder(next);
      return next;
    });

    setStatusMsg("Saved");
    setTimeout(() => setStatusMsg(""), 700);
  }

  async function removeStrengthSection() {
    if (!supabase || !item) return;
    const ok = confirm("Remove the Strength section? All blocks, exercises and sets for this session will be deleted.");
    if (!ok) return;
    setStatusMsg("Removing strength…");

    // Collect ids
    const { data: blocks, error: bErr } = await supabase
      .from("strength_blocks").select("id").eq("plan_item_id", item.id);
    if (bErr) { setStatusMsg(bErr.message); return; }

    const blockIds = (blocks ?? []).map((b: { id: any; }) => b.id);
    if (blockIds.length) {
      const { data: exs, error: eErr } = await supabase
        .from("strength_exercises").select("id").in("block_id", blockIds);
      if (eErr) { setStatusMsg(eErr.message); return; }

      const exIds = (exs ?? []).map((e: { id: any; }) => e.id);
      if (exIds.length) {
        const { error: sErr } = await supabase.from("strength_sets").delete().in("exercise_id", exIds);
        if (sErr) { setStatusMsg(sErr.message); return; }
      }
      const { error: deErr } = await supabase.from("strength_exercises").delete().in("block_id", blockIds);
      if (deErr) { setStatusMsg(deErr.message); return; }
      const { error: dbErr } = await supabase.from("strength_blocks").delete().eq("plan_item_id", item.id);
      if (dbErr) { setStatusMsg(dbErr.message); return; }
    }

    setHasStrength(false);
    setSectionOrder(prev => {
      const next = prev.filter(s => s !== "strength");
      void persistOrder(next);
      return next;
    });

    setStatusMsg("Saved");
    setTimeout(() => setStatusMsg(""), 700);
  }

  // Persist order to details.sectionOrder (jsonb or text)
  async function persistOrder(nextOrder: SectionType[]) {
    if (!item || !supabase) return;
    const detailsObj = parseDetails(item.details);
    detailsObj.sectionOrder = nextOrder;
    const payload: Partial<PlanItem> =
      typeof item.details === "string"
        ? ({ details: JSON.stringify(detailsObj) } as any)
        : ({ details: detailsObj } as any);
    await patch(payload);
  }

  function moveSection(type: SectionType, dir: -1 | 1) {
    setSectionOrder(prev => {
      const present = prev.filter((s): s is SectionType =>
        (s === "endurance" && showEndurance) || (s === "strength" && hasStrength)
      );
      const idx = present.indexOf(type);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= present.length) return prev;

      const next = [...present];
      const [row] = next.splice(idx, 1);
      next.splice(target, 0, row);
      void persistOrder(next);
      return next;
    });
  }

  function swapSections() {
    setSectionOrder(prev => {
      const present = prev.filter((s): s is SectionType =>
        (s === "endurance" && showEndurance) || (s === "strength" && hasStrength)
      );
      if (present.length !== 2) return prev;
      const next = [present[1], present[0]] as SectionType[];
      void persistOrder(next);
      return next;
    });
  }

  // Rebuild/repair sectionOrder on presence/load
  useEffect(() => {
    if (!item) return;
    const present: SectionType[] = [];
    if (showEndurance) present.push("endurance");
    if (hasStrength)  present.push("strength");

    const savedRaw = parseDetails(item.details)?.sectionOrder;
    const saved = Array.isArray(savedRaw)
      ? (savedRaw as unknown[]).filter(isSectionType)
      : undefined;

    const merged = saved
      ? [...saved.filter(s => present.includes(s)), ...present.filter(s => !saved.includes(s))]
      : present;

    setSectionOrder(merged);
  }, [item, showEndurance, hasStrength]);

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

  const bothPresent = showEndurance && hasStrength;

  // Render order fallback (typed)
  const renderOrder: SectionType[] = sectionOrder.length
    ? sectionOrder
    : ([
        ...(showEndurance ? (["endurance"] as const) : []),
        ...(hasStrength  ? (["strength"]  as const) : []),
      ] as SectionType[]);

  return (
    <div className="max-w-5xl mx-auto pb-24">
      <div
        className="card p-4"
        style={{ position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(6px)", background: "rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <Link href={`/coach-console/${athleteId}`} className="btn">← Back</Link>
          <h1 className="text-xl font-semibold">Session Composer</h1>
          <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>{statusMsg}</div>
        </div>

        <div className="mt-3 grid" style={{
          gap: 8,
          gridTemplateColumns: hideStatus ? "1fr 160px" : "1fr 160px 160px"
        }}>
          <input
            className="px-3 py-2 rounded bg-white/5 border border-white/10"
            placeholder="Session title"
            value={item.title ?? ""}
            onChange={(e) => patch({ title: e.target.value })}
          />
          <input
            type="date"
            className="px-3 py-2 rounded bg-white/5 border border-white/10"
            value={item.session_date ?? ""}
            onChange={(e) => patch({ session_date: e.target.value })}
          />
          {!hideStatus && (
            <select
              className="px-3 py-2 rounded bg-white/5 border border-white/10"
              value={item.status ?? "planned"}
              onChange={(e) => patch({ status: e.target.value as PlanItem["status"] })}
            >
              <option value="planned">Planned</option>
              <option value="completed">Completed</option>
              <option value="skipped">Skipped</option>
            </select>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          {!showEndurance && (
            <button className="btn" onClick={addEnduranceSection} disabled={!item}>
              + Add Endurance Section
            </button>
          )}
          {!hasStrength && (
            <button className="btn" onClick={addStrengthSection} disabled={!item}>
              + Add Strength Section
            </button>
          )}

          {bothPresent && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm opacity-80">Order:</span>
              <div className="text-sm opacity-80">
                {renderOrder.join(" → ").replace("endurance","Endurance").replace("strength","Strength")}
              </div>
              <button className="btn btn-dark" onClick={swapSections}>Swap sections</button>
            </div>
          )}
        </div>

        <div className="mt-3">
          <button className="btn btn-dark" onClick={del}>Delete Session</button>
        </div>
      </div>

      {/* Render sections in the chosen order */}
      {renderOrder.map((sec) => {
        if (sec === "endurance" && showEndurance) {
          const idx = renderOrder.indexOf("endurance");
          return (
            <div key="endurance" className="mt-4 card p-4">
              <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
                <h3 className="font-semibold">Endurance</h3>
                <div className="ml-auto flex items-center gap-2">
                  {bothPresent && (
                    <>
                      <button className="btn" onClick={() => moveSection("endurance", -1)} disabled={idx <= 0}>Move Up</button>
                      <button className="btn" onClick={() => moveSection("endurance", 1)} disabled={idx === (renderOrder.length - 1)}>Move Down</button>
                    </>
                  )}
                  <button className="btn btn-dark" onClick={removeEnduranceSection}>Remove Endurance</button>
                </div>
              </div>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Manage intervals, targets, and notes.
              </p>
              <div className="mt-3">
                <EnduranceEditor planItemId={item.id} athleteId={athleteId} />
              </div>
            </div>
          );
        }
        if (sec === "strength" && hasStrength) {
          const idx = renderOrder.indexOf("strength");
          return (
            <div key="strength" className="mt-4 card p-4">
              <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
                <h3 className="font-semibold">Strength</h3>
                <div className="ml-auto flex items-center gap-2">
                  {bothPresent && (
                    <>
                      <button className="btn" onClick={() => moveSection("strength", -1)} disabled={idx <= 0}>Move Up</button>
                      <button className="btn" onClick={() => moveSection("strength", 1)} disabled={idx === (renderOrder.length - 1)}>Move Down</button>
                    </>
                  )}
                  <button className="btn btn-dark" onClick={removeStrengthSection}>Remove Strength</button>
                </div>
              </div>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Add lifts, sets/reps, RPE/%RM, supersets, and demo links.
              </p>
              <div className="mt-3">
                <StrengthEditor planItemId={item.id} athleteId={athleteId} />
              </div>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
