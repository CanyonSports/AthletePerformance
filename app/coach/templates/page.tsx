// app/coach/templates/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as Supa from "@/lib/supabaseClient";

type Profile = { id: string; display_name: string | null; email: string | null };
type WeekTemplate = { id: string; coach_id: string; name: string; created_at: string };
type WeekTemplateItem = {
  id: string;
  template_id: string;
  dow: number; // 0..6 (Mon..Sun)
  title: string;
  details: any | null;        // we'll store { desc?: string }
  duration_min: number | null;
  rpe: number | null;
};

/* ---------- date helpers ---------- */
function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeekISO(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  return ymd(x);
}
function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, 12);
  dt.setDate(dt.getDate() + days);
  return ymd(dt);
}
function dowLabel(dow: number) {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow] || `D${dow}`;
}

/* ---------- page ---------- */
export default function CoachTemplatesPage() {
  // Supabase (supports getSupabase() or exported client)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  // List + selection
  const [templates, setTemplates] = useState<WeekTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  // Create/rename states
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<Record<string, string>>({});

  // Items for selected template
  const [items, setItems] = useState<WeekTemplateItem[]>([]);

  // Apply to athlete
  const [athletes, setAthletes] = useState<Profile[]>([]);
  const [applyAthlete, setApplyAthlete] = useState<string>("");
  const [applyWeekStart, setApplyWeekStart] = useState<string>(startOfWeekISO());
  const [applyMode, setApplyMode] = useState<"skip" | "overwrite">("skip");

  /* ---------- load data ---------- */
  const loadTemplates = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    setError("");
    try {
      const { data: { user }, error: uerr } = await supabase.auth.getUser();
      if (uerr) throw uerr;
      if (!user) throw new Error("Sign in required");

      const res = await supabase
        .from("coach_week_templates")
        .select("*")
        .eq("coach_id", user.id)
        .order("created_at", { ascending: false });
      if (res.error) throw res.error;

      setTemplates((res.data ?? []) as WeekTemplate[]);
      // If selection vanished (deleted), clear selection
      if (selectedId && !(res.data ?? []).some((t: any) => t.id === selectedId)) {
        setSelectedId("");
        setItems([]);
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [isConfigured, supabase, selectedId]);

  const loadItems = useCallback(async (templateId: string) => {
    if (!isConfigured || !supabase || !templateId) { setItems([]); return; }
    setError("");
    const res = await supabase
      .from("coach_week_template_items")
      .select("*")
      .eq("template_id", templateId)
      .order("dow", { ascending: true });
    if (res.error) { setError(res.error.message ?? String(res.error)); return; }
    setItems((res.data ?? []) as WeekTemplateItem[]);
  }, [isConfigured, supabase]);

  const loadAthletes = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const links = await supabase.from("coach_athletes").select("athlete_id").eq("coach_id", user.id);
      if (links.error) throw links.error;
      const ids = (links.data ?? []).map((r: any) => r.athlete_id);
      if (ids.length === 0) { setAthletes([]); setApplyAthlete(""); return; }

      const profs = await supabase.from("profiles").select("id,display_name,email").in("id", ids);
      if (profs.error) throw profs.error;
      const sorted = (profs.data ?? []).sort((a: Profile, b: Profile) =>
        (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "")
      );
      setAthletes(sorted);
      setApplyAthlete((sorted[0]?.id) || "");
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [isConfigured, supabase]);

  useEffect(() => { loadTemplates(); loadAthletes(); }, [loadTemplates, loadAthletes]);
  useEffect(() => { loadItems(selectedId); }, [selectedId, loadItems]);

  /* ---------- template CRUD ---------- */
  async function createTemplate() {
    if (!isConfigured || !supabase) return;
    const name = newName.trim();
    if (!name) return;
    setStatus("Creating…");
    setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required");
      const ins = await supabase
        .from("coach_week_templates")
        .insert({ coach_id: user.id, name })
        .select("*")
        .single();
      if (ins.error) throw ins.error;

      setCreating(false);
      setNewName("");
      await loadTemplates();
      setSelectedId(ins.data.id);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setStatus("");
    }
  }

  async function renameTemplate(id: string) {
    if (!isConfigured || !supabase) return;
    const name = (renaming[id] || "").trim();
    if (!name) return;
    setStatus("Renaming…");
    const { error } = await supabase.from("coach_week_templates").update({ name }).eq("id", id);
    setStatus("");
    if (error) { setError(error.message ?? String(error)); return; }
    setRenaming((r) => ({ ...r, [id]: "" }));
    await loadTemplates();
  }

  async function deleteTemplate(id: string) {
    if (!isConfigured || !supabase) return;
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setStatus("Deleting…");
    const { error } = await supabase.from("coach_week_templates").delete().eq("id", id);
    setStatus("");
    if (error) { setError(error.message ?? String(error)); return; }
    if (selectedId === id) { setSelectedId(""); setItems([]); }
    await loadTemplates();
  }

  /* ---------- item helpers ---------- */
  function itemsForDow(dow: number) {
    // no explicit order index in schema; show in insertion/id order (stable-ish)
    return items.filter((it) => it.dow === dow);
  }

  function extractDesc(details: any): string {
    if (!details) return "";
    if (typeof details === "string") return details;
    if (typeof details === "object" && details.desc != null) return String(details.desc);
    return "";
  }

  async function addItem(dow: number) {
    if (!isConfigured || !supabase || !selectedId) return;
    setStatus("Adding…");
    setError("");
    const ins = await supabase
      .from("coach_week_template_items")
      .insert({ template_id: selectedId, dow, title: "Session", details: { desc: "" }, duration_min: 60, rpe: null })
      .select("*")
      .single();
    setStatus("");
    if (ins.error) { setError(ins.error.message ?? String(ins.error)); return; }
    setItems((prev) => [...prev, ins.data as WeekTemplateItem]);
  }

  async function updateItem(id: string, patch: Partial<WeekTemplateItem>) {
    if (!isConfigured || !supabase) return;
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } as WeekTemplateItem : r)));
    const { error } = await supabase.from("coach_week_template_items").update(patch).eq("id", id);
    if (error) setError(error.message ?? String(error));
  }

  async function deleteItem(id: string) {
    if (!isConfigured || !supabase) return;
    const { error } = await supabase.from("coach_week_template_items").delete().eq("id", id);
    if (error) { setError(error.message ?? String(error)); return; }
    setItems((prev) => prev.filter((r) => r.id !== id));
  }

  /* ---------- apply to athlete ---------- */
  async function applyTemplate() {
    if (!isConfigured || !supabase) return;
    if (!selectedId) { setError("Choose a template first."); return; }
    if (!applyAthlete) { setError("Choose an athlete."); return; }
    if (!applyWeekStart) { setError("Pick a week start date."); return; }

    setStatus("Applying template…");
    setError("");

    try {
      const itRes = await supabase
        .from("coach_week_template_items")
        .select("*")
        .eq("template_id", selectedId);
      if (itRes.error) throw itRes.error;
      const rows = (itRes.data ?? []) as WeekTemplateItem[];
      if (rows.length === 0) throw new Error("This template has no items.");

      if (applyMode === "overwrite") {
        const dows = Array.from(new Set(rows.map((r) => r.dow)));
        for (const dow of dows) {
          const dayISO = addDaysISO(applyWeekStart, dow);
          const del = await supabase
            .from("training_plan_items")
            .delete()
            .eq("user_id", applyAthlete)
            .eq("session_date", dayISO);
          if (del.error) throw del.error;
        }
      }

      const payload = rows.map((r) => ({
        user_id: applyAthlete,
        session_date: addDaysISO(applyWeekStart, r.dow),
        title: r.title,
        details: r.details ?? null,
        duration_min: r.duration_min ?? null,
        rpe: r.rpe ?? null,
        status: "planned",
      }));

      const ins = await supabase.from("training_plan_items").insert(payload);
      if (ins.error) throw ins.error;

      setStatus("Applied ✓");
      setTimeout(() => setStatus(""), 900);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setStatus("");
    }
  }

  /* ---------- UI ---------- */
  return (
    <div className="max-w-7xl mx-auto pb-16">
      {/* Top bar */}
      <div
        className="card p-4"
        style={{ position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(6px)", background: "rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <Link href="/coach" className="btn">← Back</Link>
          <h1 className="text-xl font-semibold">Templates</h1>
          <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>{status}</div>
        </div>
        {error ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{error}</div> : null}
      </div>

      {/* Layout */}
      <div className="mt-4 grid" style={{ gridTemplateColumns: "minmax(260px, 360px) 1fr", gap: 16 }}>
        {/* LEFT: Templates list + create */}
        <aside className="space-y-3">
          <div className="card p-4">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Your Templates</h3>
              <button className="btn btn-dark ml-auto" onClick={() => setCreating((v) => !v)}>
                {creating ? "Cancel" : "New Template"}
              </button>
            </div>

            {creating && (
              <div className="mt-3 grid" style={{ gap: 8 }}>
                <input
                  className="px-3 py-2 rounded bg-white/5 border border-white/10"
                  placeholder="Template name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <button className="btn btn-dark" onClick={createTemplate} disabled={!newName.trim()}>
                  Create
                </button>
              </div>
            )}

            <div className="mt-3 space-y-2">
              {templates.length === 0 ? (
                <div className="text-sm" style={{ color: "var(--muted)" }}>
                  No templates yet. Create one or save from a week in the coach console.
                </div>
              ) : (
                templates.map((t) => (
                  <div key={t.id} className={`rounded p-2 ${selectedId === t.id ? "bg-white/10" : "bg-white/5"}`}>
                    {renaming[t.id] != null && renaming[t.id] !== "" ? (
                      <div className="flex items-center gap-2">
                        <input
                          className="px-3 py-2 rounded bg-white/5 border border-white/10 flex-1"
                          value={renaming[t.id]}
                          onChange={(e) => setRenaming((r) => ({ ...r, [t.id]: e.target.value }))}
                          autoFocus
                        />
                        <button className="btn btn-dark" onClick={() => renameTemplate(t.id)}>Save</button>
                        <button className="btn" onClick={() => setRenaming((r) => ({ ...r, [t.id]: "" }))}>Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          className="text-left flex-1"
                          onClick={() => setSelectedId(t.id)}
                          title={new Date(t.created_at).toLocaleString()}
                        >
                          <div className="font-semibold">{t.name}</div>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>
                            Created {new Date(t.created_at).toLocaleDateString()}
                          </div>
                        </button>
                        <button className="btn" onClick={() => setRenaming((r) => ({ ...r, [t.id]: t.name }))}>Rename</button>
                        <button className="btn btn-dark" onClick={() => deleteTemplate(t.id)}>Delete</button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* RIGHT: Editor + Apply */}
        <main className="flex flex-col gap-3">
          {/* EDITOR */}
          <div className="card p-4">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Edit Template</h3>
              {selectedId ? null : <span className="text-sm" style={{ color: "var(--muted)" }}>(select a template)</span>}
            </div>

            {!selectedId ? (
              <div className="text-sm mt-2" style={{ color: "var(--muted)" }}>
                Choose a template on the left to add sessions by day.
              </div>
            ) : (
              <div className="mt-3 grid" style={{ gap: 10, gridTemplateColumns: "repeat(2, minmax(280px, 1fr))" }}>
                {Array.from({ length: 7 }, (_, dow) => dow).map((dow) => {
                  const dayItems = itemsForDow(dow);
                  return (
                    <div key={dow} className="rounded border border-white/10 p-3">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold">{dowLabel(dow)}</div>
                        <button className="btn btn-dark ml-auto" onClick={() => addItem(dow)}>+ Add</button>
                      </div>

                      {dayItems.length === 0 ? (
                        <div className="text-sm mt-2" style={{ color: "var(--muted)" }}>—</div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {dayItems.map((it) => {
                            const desc = extractDesc(it.details);
                            return (
                              <div key={it.id} className="rounded bg-white/5 p-2">
                                <div className="grid" style={{ gap: 6, gridTemplateColumns: "1fr 110px 90px auto" }}>
                                  <input
                                    className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                    placeholder="Title"
                                    value={it.title}
                                    onChange={(e) => updateItem(it.id, { title: e.target.value })}
                                  />
                                  <input
                                    className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                    inputMode="numeric"
                                    placeholder="Duration"
                                    value={it.duration_min ?? ""}
                                    onChange={(e) => {
                                      const raw = e.target.value.replace(/[^0-9]/g, "");
                                      updateItem(it.id, { duration_min: raw === "" ? null : Number(raw) });
                                    }}
                                    title="Duration (minutes)"
                                  />
                                  <input
                                    className="px-2 py-1 rounded bg-white/5 border border-white/10"
                                    inputMode="numeric"
                                    placeholder="RPE"
                                    value={it.rpe ?? ""}
                                    onChange={(e) => {
                                      const raw = e.target.value.replace(/[^0-9]/g, "");
                                      const val = raw === "" ? null : Math.max(1, Math.min(10, Number(raw)));
                                      updateItem(it.id, { rpe: val });
                                    }}
                                    title="RPE 1–10"
                                  />
                                  <div className="flex items-center justify-end">
                                    <button className="btn btn-dark" onClick={() => deleteItem(it.id)}>Delete</button>
                                  </div>
                                </div>

                                <textarea
                                  className="w-full mt-2 px-2 py-1 rounded bg-white/5 border border-white/10"
                                  rows={2}
                                  placeholder="Description (optional)"
                                  value={desc}
                                  onChange={(e) => updateItem(it.id, { details: { desc: e.target.value } })}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* APPLY */}
          <div className="card p-4">
            <h3 className="font-semibold">Assign Template</h3>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Choose an athlete, pick the week start (Monday), and whether to add or overwrite existing sessions on the same days.
            </p>

            <div className="mt-3 grid" style={{ gap: 8, gridTemplateColumns: "1fr 1fr 1fr" }}>
              <select
                className="px-3 py-2 rounded bg-white/5 border border-white/10"
                value={applyAthlete}
                onChange={(e) => setApplyAthlete(e.target.value)}
              >
                <option value="">Select athlete…</option>
                {athletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.display_name || a.email || a.id).toString()}
                  </option>
                ))}
              </select>

              <input
                type="date"
                className="px-3 py-2 rounded bg-white/5 border border-white/10"
                value={applyWeekStart}
                onChange={(e) => setApplyWeekStart(e.target.value || startOfWeekISO())}
                title="Target week start (Monday)"
              />

              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="applyMode"
                    checked={applyMode === "skip"}
                    onChange={() => setApplyMode("skip")}
                  />
                  Add (skip existing)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="applyMode"
                    checked={applyMode === "overwrite"}
                    onChange={() => setApplyMode("overwrite")}
                  />
                  Overwrite days
                </label>
              </div>
            </div>

            <div className="mt-3">
              <button
                className="btn btn-dark"
                onClick={applyTemplate}
                disabled={!selectedId || !applyAthlete}
                title={!selectedId ? "Select a template first" : ""}
              >
                Assign to athlete
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
