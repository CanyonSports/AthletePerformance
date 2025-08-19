// app/training/programs/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import NavBar from "@/components/NavBar";
import { getSupabase } from "@/lib/supabaseClient";
import { CalendarDays, Save, Trash2, ChevronRight, Edit3 } from "lucide-react";

/* ----------------------------- Types ----------------------------- */

type Program = {
  id?: string;
  owner_id?: string;
  title: string;
  description?: string | null;
  weeks: number;
};

type ProgramItemDraft = {
  title: string;
  details: string;
};

const EMPTY_CELL: ProgramItemDraft = {
  title: "",
  details: "",
};

/* ----------------------------- Date utils ----------------------------- */

const ymd = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const fromYMD = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
};
const addDaysISO = (iso: string, days: number) => {
  const dt = fromYMD(iso);
  dt.setDate(dt.getDate() + days);
  return ymd(dt);
};

/* ----------------------------- Page ----------------------------- */

export default function ProgramBuilderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const supabase = useMemo(() => {
    try { return getSupabase(); } catch { return null; }
  }, []);
  const isConfigured = Boolean(supabase);

  const [meId, setMeId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // builder
  const [program, setProgram] = useState<Program>({ title: "My Program", description: "", weeks: 4 });
  const totalDays = Math.max(1, Math.min(52, program.weeks)) * 7;
  const [grid, setGrid] = useState<Record<number, ProgramItemDraft>>({});

  // list
  const [myPrograms, setMyPrograms] = useState<(Program & { created_at: string; items_count?: number })[]>([]);
  const [loading, setLoading] = useState(false);

  // focus/highlight of a day after returning from Day Builder
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const cellRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => { (async () => {
    if (!isConfigured || !supabase) return;
    const { data: { user } = { user: null } } = await supabase.auth.getUser();
    setMeId(user?.id ?? null);
  })(); }, [isConfigured, supabase]);

  const loadMyPrograms = useCallback(async () => {
    if (!isConfigured || !supabase || !meId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("programs")
        .select("id, owner_id, title, description, weeks, created_at")
        .eq("owner_id", meId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const list = (data ?? []) as any[];
      const ids = list.map((p) => p.id);
      let counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: countRows } = await supabase
          .from("program_items")
          .select("program_id, id")
          .in("program_id", ids);
        (countRows ?? []).forEach((r: any) => {
          counts[r.program_id] = (counts[r.program_id] || 0) + 1;
        });
      }
      setMyPrograms(list.map((p) => ({ ...p, items_count: counts[p.id] || 0 })));
    } catch (e) {
      setNote(String(e));
    } finally { setLoading(false); }
  }, [isConfigured, supabase, meId]);

  useEffect(() => { if (meId) loadMyPrograms(); }, [meId, loadMyPrograms]);

  // Auto-open a program (and optionally focus a day) when returning from Day Builder
  useEffect(() => {
    const openId = searchParams.get("open");
    const focus = searchParams.get("focus");
    const focusNum = focus ? Number(focus) : NaN;

    if (openId) {
      loadProgramIntoBuilder(openId);
    }
    if (!Number.isNaN(focusNum)) {
      setFocusIdx(focusNum);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // After grid renders, scroll/highlight the focused cell if any
  useEffect(() => {
    if (focusIdx == null) return;
    const el = cellRefs.current[focusIdx];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      el.animate?.(
        [
          { boxShadow: "0 0 0 0 rgba(59,130,246,0)" },
          { boxShadow: "0 0 0 4px rgba(59,130,246,.6)" },
          { boxShadow: "0 0 0 0 rgba(59,130,246,0)" }
        ],
        { duration: 900 }
      );
    }
  }, [focusIdx, grid, totalDays]);

  /* ----------------------------- Grid editing ----------------------------- */

  const onChangeCell = (idx: number, patch: Partial<ProgramItemDraft>) => {
    setGrid(prev => {
      const base = prev[idx] ?? EMPTY_CELL;
      return { ...prev, [idx]: { ...base, ...patch } };
    });
  };

  /* ----------------------------- Persistence ----------------------------- */

  // Save program & items — MERGE (preserves Day Builder fields like structure, duration, rpe)
  const saveProgram = useCallback(async (): Promise<string | null> => {
    if (!isConfigured || !supabase || !meId) return null;
    const trimmedTitle = (program.title || "").trim();
    if (!trimmedTitle) { setNote("Title required"); return null; }

    try {
      setLoading(true);
      let programId = program.id;

      // 1) Upsert program row
      if (!programId) {
        const { data, error } = await supabase
          .from("programs")
          .insert({
            owner_id: meId,
            title: trimmedTitle,
            description: program.description || null,
            weeks: program.weeks,
          })
          .select("id")
          .single();
        if (error) throw error;
        programId = (data as any)?.id as string;
        setProgram(p => ({ ...p, id: programId! }));
      } else {
        const { error } = await supabase
          .from("programs")
          .update({
            title: trimmedTitle,
            description: program.description || null,
            weeks: program.weeks,
          })
          .eq("id", programId);
        if (error) throw error;
      }

      // 2) Merge program_items by day_index (no wipe)
      const { data: existing, error: exErr } = await supabase
        .from("program_items")
        .select("id, day_index")
        .eq("program_id", programId);
      if (exErr) throw exErr;

      const existingMap = new Map<number, string>();
      (existing ?? []).forEach((r: any) => existingMap.set(r.day_index, r.id));

      const entries = Object.entries(grid)
        .filter(([, v]) => (v?.title || "").trim().length > 0)
        .map(([k, v]) => [parseInt(k, 10), v] as [number, ProgramItemDraft]);

      const keepIndices = new Set(entries.map(([idx]) => idx));
      const toDelete: number[] = [];
      for (const idx of existingMap.keys()) {
        if (!keepIndices.has(idx)) toDelete.push(idx);
      }

      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from("program_items")
          .delete()
          .eq("program_id", programId)
          .in("day_index", toDelete);
        if (delErr) throw delErr;
      }

      // updates & inserts
      const updates: { id: string; title: string; details: string | null }[] = [];
      const inserts: {
        program_id: string;
        day_index: number;
        title: string;
        details: string | null;
      }[] = [];

      for (const [idx, v] of entries) {
        const id = existingMap.get(idx);
        if (id) {
          updates.push({
            id,
            title: (v.title || "").trim(),
            details: (v.details || "").trim() || null,
          });
        } else {
          inserts.push({
            program_id: programId!,
            day_index: idx,
            title: (v.title || "").trim(),
            details: (v.details || "").trim() || null,
          });
        }
      }

      if (inserts.length > 0) {
        const { error: insErr } = await supabase.from("program_items").insert(inserts);
        if (insErr) throw insErr;
      }

      if (updates.length > 0) {
        const batchSize = 20;
        for (let i = 0; i < updates.length; i += batchSize) {
          const slice = updates.slice(i, i + batchSize);
          await Promise.all(
            slice.map(u =>
              supabase.from("program_items").update({ title: u.title, details: u.details }).eq("id", u.id)
            )
          );
        }
      }

      setNote("Saved");
      setTimeout(() => setNote(""), 1200);
      loadMyPrograms();
      return programId!;
    } catch (e) {
      setNote(String(e));
      return null;
    } finally { setLoading(false); }
  }, [isConfigured, supabase, meId, program, grid, loadMyPrograms]);

  // Apply program to calendar
  const applyProgramToCalendar = useCallback(async (startIso: string) => {
    if (!isConfigured || !supabase || !meId) return;
    const validStart = /^\d{4}-\d{2}-\d{2}$/.test(startIso);
    if (!validStart) { setNote("Pick a valid start date"); return; }

    try {
      setLoading(true);
      let programId = await saveProgram();
      if (!programId) {
        const { data } = await supabase
          .from("programs")
          .select("id")
          .eq("owner_id", meId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        programId = (data as any)?.id ?? null;
      }
      if (!programId) throw new Error("Program not found.");

      const { data: items, error } = await supabase
        .from("program_items")
        .select("day_index,title,details,duration_min,rpe,structure")
        .eq("program_id", programId)
        .order("day_index", { ascending: true });
      if (error) throw error;

      const rows = (items || []).map((it: any) => ({
        id: (globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
        user_id: meId,
        session_date: addDaysISO(startIso, it.day_index),
        title: it.title,
        details: it.details ?? null,
        structure: it.structure ?? null,
        duration_min: it.duration_min ?? null,
        rpe: it.rpe ?? null,
        status: "planned" as const,
      }));

      if (rows.length) {
        const size = 200;
        for (let i = 0; i < rows.length; i += size) {
          const chunk = rows.slice(i, i + size);
          const { error: insErr } = await supabase.from("training_plan_items").insert(chunk);
          if (insErr) throw insErr;
        }
      }

      setNote("Applied to calendar");
      setTimeout(() => setNote(""), 1500);
      router.push("/training/calendar");
    } catch (e) {
      setNote(String(e));
    } finally { setLoading(false); }
  }, [isConfigured, supabase, meId, saveProgram, router]);

  const loadProgramIntoBuilder = useCallback(async (programId: string) => {
    if (!isConfigured || !supabase) return;
    try {
      const { data: p, error } = await supabase
        .from("programs")
        .select("id, owner_id, title, description, weeks")
        .eq("id", programId).single();
      if (error) throw error;

      const { data: items } = await supabase
        .from("program_items")
        .select("day_index,title,details")
        .eq("program_id", programId);

      setProgram(p as Program);
      const g: Record<number, ProgramItemDraft> = {};
      (items || []).forEach((it: any) => {
        g[it.day_index] = {
          title: it.title || "",
          details: it.details || "",
        };
      });
      setGrid(g);
    } catch (e) {
      setNote(String(e));
    }
  }, [isConfigured, supabase]);

  const deleteProgram = useCallback(async (programId: string) => {
    if (!isConfigured || !supabase) return;
    try {
      await supabase.from("program_items").delete().eq("program_id", programId);
      await supabase.from("programs").delete().eq("id", programId);
      if (program.id === programId) {
        setProgram({ title: "My Program", description: "", weeks: 4 });
        setGrid({});
      }
      loadMyPrograms();
    } catch (e) {
      setNote(String(e));
    }
  }, [isConfigured, supabase, program.id, loadMyPrograms]);

  const [applyStart, setApplyStart] = useState<string>(() => ymd(new Date()));

  /* ----------------------------- Open Day helper ----------------------------- */
  // Ensures the program exists (auto-saves if needed), then navigates to the Day Builder with a returnTo param
  const openDay = useCallback(async (idx: number) => {
    if (loading) return;
    setNote("");
    let id = program.id;
    if (!id) {
      const savedId = await saveProgram();
      if (!savedId) { setNote("Please enter a title and try saving again."); return; }
      id = savedId;
    }
    const returnTo = `/training/programs?open=${id}&focus=${idx}`;
    router.push(`/training/programs/${id}/day/${idx}?returnTo=${encodeURIComponent(returnTo)}`);
  }, [program.id, saveProgram, router, loading]);

  /* ----------------------------- UI helpers ----------------------------- */

  const DayHeader = () => (
    <div className="grid grid-cols-7 gap-1 text-xs md:text-sm" style={{ color: "var(--muted)" }}>
      {"Mon Tue Wed Thu Fri Sat Sun".split(" ").map((d) => (
        <div key={d} className="px-2 py-1 text-center">{d}</div>
      ))}
    </div>
  );

  const gridCells: number[] = Array.from({ length: totalDays }, (_, i) => i);

  /* ----------------------------- Render ----------------------------- */

  return (
    <div className="max-w-7xl mx-auto pb-20">
      <NavBar />

      {/* Header */}
      <div className="mt-6 card p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="rounded-full p-2 bg-white/10"><CalendarDays className="w-5 h-5 text-emerald-300" /></div>
          <div>
            <h1 className="text-xl font-semibold">Program Builder</h1>
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Create a multi-week plan, save it, and apply it to your calendar.
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link className="btn" href="/training">Back to Week</Link>
          </div>
        </div>
        {note ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div> : null}
      </div>

      {/* Programs list */}
      <div className="mt-4 card p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">My Programs</h3>
          {loading ? <span className="text-xs" style={{ color: "var(--muted)" }}>Loading…</span> : null}
        </div>
        {myPrograms.length === 0 ? (
          <div className="text-sm mt-2" style={{ color: "var(--muted)" }}>No programs yet.</div>
        ) : (
          <div className="mt-2 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {myPrograms.map((p) => (
              <div key={p.id} className="card p-3">
                <div className="font-medium truncate">{p.title}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {p.weeks} weeks • {p.items_count || 0} items
                </div>
                <div className="mt-2 flex gap-2">
                  <button className="btn" onClick={() => loadProgramIntoBuilder(p.id!)}>Open</button>
                  <button className="btn btn-dark" onClick={() => deleteProgram(p.id!)} title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Builder controls */}
      <div className="mt-4 card p-4">
        <div className="grid md:grid-cols-3 gap-3">
          <label className="block">
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Title</div>
            <input className="field w-full" value={program.title} onChange={(e) => setProgram({ ...program, title: e.target.value })} />
          </label>
          <label className="block">
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Weeks</div>
            <input
              type="number" min={1} max={52} className="field w-full" value={program.weeks}
              onChange={(e) => setProgram({
                ...program,
                weeks: Math.max(1, Math.min(52, parseInt(e.target.value || "1", 10))),
              })}
            />
          </label>
          <label className="block md:col-span-1">
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Apply start date</div>
            <input type="date" className="field w-full" value={applyStart} onChange={(e) => setApplyStart(e.target.value || applyStart)} />
          </label>
        </div>

        <div className="mt-3 flex gap-2">
          <button className="btn" onClick={saveProgram}><Save className="w-4 h-4 mr-1" /> Save Program</button>
          <button className="btn btn-dark" onClick={() => applyProgramToCalendar(applyStart)}>
            <ChevronRight className="w-4 h-4 mr-1" /> Apply to Calendar
          </button>
        </div>
      </div>

      {/* Grid editor */}
      <div className="mt-4 card p-4">
        <DayHeader />
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: totalDays }, (_, idx) => {
            const wk = Math.floor(idx / 7) + 1;
            const cell = grid[idx] ?? EMPTY_CELL;

            return (
              <div
                key={idx}
                id={`day-${idx}`}
                ref={el => { cellRefs.current[idx] = el; }}
                className={`rounded-lg border p-2 bg-white/5 flex flex-col gap-2 transition
                    ${focusIdx === idx ? "ring-2 ring-blue-400" : ""}`}
                style={{ borderColor: "#ffffff1a" }}
              >
                <div className="text-[10px] opacity-70">Week {wk}</div>

                <input
                  className="w-full px-2 py-1 rounded bg-white/10 text-sm"
                  placeholder="Session title"
                  value={cell.title}
                  onChange={(e) => onChangeCell(idx, { title: e.target.value })}
                />

                <textarea
                  className="w-full px-2 py-1 rounded bg-white/10 text-xs"
                  placeholder="Details (optional)"
                  rows={2}
                  value={cell.details}
                  onChange={(e) => onChangeCell(idx, { details: e.target.value })}
                />

                <div className="flex items-center">
                  <button
                    className="btn btn-dark ml-auto"
                    onClick={() => openDay(idx)}
                    disabled={loading}
                    title="Open Day Builder"
                  >
                    <Edit3 className="w-4 h-4 mr-1" /> Edit Day
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
