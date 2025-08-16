// components/TemplateEditor.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";

type Sport = "climbing" | "ski" | "mtb" | "running";

type Template = {
  id: string;
  coach_id: string;
  sport: Sport;
  name: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
};

type TemplateItem = {
  id: string;
  template_id: string;
  day_offset: number; // 0..6 (Mon..Sun)
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  created_at: string;
};

// Editable row model (string for number inputs to allow empty)
type ItemDraft = {
  id?: string;               // absent => new
  day_offset: number;        // 0..6
  title: string;
  details: string;
  duration_min: string;      // "" or number-as-string
  rpe: string;               // "" or number-as-string
};

type Props = {
  sport: Sport;
  athleteId: string | null;
  weekStart: string; // yyyy-mm-dd
  onApplied?: () => void;
};

const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

export default function TemplateEditor({ sport, athleteId, weekStart, onApplied }: Props) {
  // Supabase client (supports either getSupabase() factory or supabase constant)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [meId, setMeId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [applyStatus, setApplyStatus] = useState("");

  // List of coach templates for current sport
  const [list, setList] = useState<Template[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Editing state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplPublic, setTplPublic] = useState(false);
  const [rows, setRows] = useState<ItemDraft[]>([]);
  const [originalItemIds, setOriginalItemIds] = useState<string[]>([]); // to detect deletions

  // Apply options
  const [clearExisting, setClearExisting] = useState(false);

  // Load user id
  useEffect(() => {
    (async () => {
      try {
        if (!supabase) return;
        const { data: { user } } = await supabase.auth.getUser();
        setMeId(user?.id ?? null);
      } catch {}
    })();
  }, [supabase]);

  // Load templates list
  async function loadTemplates() {
    setLoadingList(true); setNote("");
    try {
      if (!supabase || !meId) { setLoadingList(false); return; }
      const { data, error } = await supabase
        .from("plan_templates")
        .select("*")
        .eq("coach_id", meId)
        .eq("sport", sport)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setList((data || []) as Template[]);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoadingList(false);
    }
  }
  useEffect(() => { loadTemplates(); /* eslint-disable-next-line */ }, [supabase, meId, sport]);

  // Helpers
  const emptyRow = (): ItemDraft => ({
    day_offset: 0, title: "", details: "", duration_min: "", rpe: ""
  });
  const setRow = (i: number, patch: Partial<ItemDraft>) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const addRow = () => setRows(r => [...r, emptyRow()]);
  const removeRow = (i: number) => setRows(r => r.filter((_, idx) => idx !== i));

  // Begin editing (new or existing)
  function startNewTemplate() {
    setSelectedId(null);
    setTplName("");
    setTplDesc("");
    setTplPublic(false);
    setRows([emptyRow()]);
    setOriginalItemIds([]);
    setNote("");
  }

  async function startEditTemplate(id: string) {
    setNote("");
    try {
      if (!supabase) return;
      const { data: tpl, error: tErr } = await supabase
        .from("plan_templates").select("*").eq("id", id).single();
      if (tErr) throw tErr;
      const t = tpl as Template;
      setSelectedId(t.id);
      setTplName(t.name);
      setTplDesc(t.description ?? "");
      setTplPublic(Boolean(t.is_public));

      const { data: items, error: iErr } = await supabase
        .from("plan_template_items")
        .select("*")
        .eq("template_id", id)
        .order("day_offset", { ascending: true })
        .order("created_at", { ascending: true });
      if (iErr) throw iErr;

      const drafts: ItemDraft[] = (items || []).map((it: TemplateItem) => ({
        id: it.id,
        day_offset: it.day_offset,
        title: it.title ?? "",
        details: it.details ?? "",
        duration_min: it.duration_min == null ? "" : String(it.duration_min),
        rpe: it.rpe == null ? "" : String(it.rpe),
      }));
      setRows(drafts.length ? drafts : [emptyRow()]);
      setOriginalItemIds(drafts.map(d => d.id!).filter(Boolean));
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }

  // Save create or edits
  async function saveTemplate() {
    setNote("");
    try {
      if (!supabase || !meId) throw new Error("Not signed in");
      if (!tplName.trim()) throw new Error("Template name is required");

      let templateId = selectedId;

      if (!templateId) {
        // create
        const { data: tpl, error: insTplErr } = await supabase
          .from("plan_templates")
          .insert({
            coach_id: meId, sport, name: tplName.trim(),
            description: tplDesc.trim() || null,
            is_public: tplPublic
          })
          .select("*")
          .single();
        if (insTplErr) throw insTplErr;
        templateId = (tpl as any).id as string;
        setSelectedId(templateId);
      } else {
        // update meta
        const { error: upTplErr } = await supabase
          .from("plan_templates")
          .update({
            name: tplName.trim(),
            description: tplDesc.trim() || null,
            is_public: tplPublic
          })
          .eq("id", templateId);
        if (upTplErr) throw upTplErr;
      }

      // Prepare item rows
      const toUpsert = rows
        .filter(r => r.title.trim())
        .map(r => ({
          ...(r.id ? { id: r.id } : {}),
          template_id: templateId!,
          day_offset: Number(r.day_offset),
          title: r.title.trim(),
          details: r.details.trim() || null,
          duration_min: r.duration_min === "" ? null : Number(r.duration_min),
          rpe: r.rpe === "" ? null : Number(r.rpe),
        }));

      if (toUpsert.length) {
        const { error: upsertErr } = await supabase
          .from("plan_template_items")
          .upsert(toUpsert, { onConflict: "id" });
        if (upsertErr) throw upsertErr;
      }

      // Delete removed items (present before, not present now)
      const currentIds = new Set(toUpsert.filter(r => "id" in r).map((r: any) => r.id as string));
      const toDelete = originalItemIds.filter(id => !currentIds.has(id));
      if (toDelete.length) {
        const { error: delErr } = await supabase
          .from("plan_template_items")
          .delete()
          .in("id", toDelete);
        if (delErr) throw delErr;
      }

      // Refresh list + baseline
      await loadTemplates();
      setOriginalItemIds(toUpsert.filter((x: any) => x.id).map((x: any) => x.id));
      setNote("Template saved.");
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }

  async function deleteTemplate(id: string) {
    setNote("");
    try {
      if (!supabase) return;
      await supabase.from("plan_templates").delete().eq("id", id);
      if (selectedId === id) startNewTemplate();
      await loadTemplates();
      setNote("Template deleted.");
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }

  async function applyTemplate(templateId: string) {
    setApplyStatus("Applying…");
    try {
      if (!supabase) throw new Error("Supabase not configured");
      if (!athleteId) throw new Error("No athlete selected");
      if (!weekStart) throw new Error("No week selected");

      const { data, error } = await supabase.rpc("apply_template_to_week", {
        p_template_id: templateId,
        p_athlete_id: athleteId,
        p_week_start: weekStart,
        p_clear_existing: clearExisting,
      });
      if (error) throw error;

      setApplyStatus(`Applied ${data ?? 0} sessions to ${weekStart}.`);
      if (onApplied) onApplied();
    } catch (e: any) {
      setApplyStatus(e.message ?? String(e));
    }
  }

  // Live preview grouped by day
  const previewDays: { day: string; items: ItemDraft[] }[] = (() => {
    const grouped: Record<number, ItemDraft[]> = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
    for (const r of rows) grouped[r.day_offset]?.push(r);
    return Array.from({ length: 7 }, (_, i) => ({
      day: days[i],
      items: (grouped[i] || []).filter(it => it.title.trim())
    }));
  })();

  return (
    <div className="card p-4 mt-6">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold">Training Plan Templates</h3>
        <span className="badge" style={{ textTransform: "uppercase" }}>{sport}</span>
        {note ? <span className="text-xs" style={{ color:"#fca5a5", marginLeft: 8 }}>{note}</span> : null}
      </div>

      {/* Editor header */}
      <div className="card p-4 mt-3">
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <input
            value={tplName}
            onChange={e => setTplName(e.target.value)}
            placeholder="Template name (e.g., Base Week A)"
            className="px-3 py-2 rounded bg-white/5 border border-white/10"
          />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={tplPublic} onChange={e => setTplPublic(e.target.checked)} />
            <span className="text-sm" style={{ color:"var(--muted)" }}>Public (read-only to others)</span>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-pine" onClick={saveTemplate}>Save</button>
            <button className="btn btn-dark" onClick={startNewTemplate}>New</button>
            {selectedId && (
              <button className="btn btn-dark" onClick={() => deleteTemplate(selectedId!)}>Delete</button>
            )}
          </div>
        </div>
        <textarea
          value={tplDesc}
          onChange={e => setTplDesc(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="w-full mt-2"
        />

        {/* Row editor */}
        <div className="mt-3" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{minWidth:100}}>Day</th>
                <th>Title</th>
                <th>Details</th>
                <th style={{width:140}}>Duration (min)</th>
                <th style={{width:120}}>RPE</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? `new-${i}`}>
                  <td>
                    <select value={r.day_offset} onChange={e => setRow(i, { day_offset: Number(e.target.value) })}>
                      {days.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
                    </select>
                  </td>
                  <td>
                    <input value={r.title} onChange={e => setRow(i, { title: e.target.value })} placeholder="Session title" />
                  </td>
                  <td>
                    <input value={r.details} onChange={e => setRow(i, { details: e.target.value })} placeholder="Details (optional)" />
                  </td>
                  <td>
                    <input type="number" value={r.duration_min} onChange={e => setRow(i, { duration_min: e.target.value })} placeholder="min" />
                  </td>
                  <td>
                    <input type="number" value={r.rpe} onChange={e => setRow(i, { rpe: e.target.value })} placeholder="RPE" />
                  </td>
                  <td>
                    <button className="btn btn-dark" onClick={() => removeRow(i)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2">
            <button className="btn btn-dark" onClick={addRow}>Add Row</button>
          </div>
        </div>
      </div>

      {/* Existing templates list + Apply */}
      <div className="mt-4">
        <div className="flex items-center gap-3">
          <h4 className="text-base font-semibold">Your {sport} Templates</h4>
          <label className="flex items-center gap-2" title="Delete planned sessions for this week (same sport) before applying">
            <input type="checkbox" checked={clearExisting} onChange={e => setClearExisting(e.target.checked)} />
            <span className="text-sm" style={{ color: "var(--muted)" }}>Clear existing week before apply</span>
          </label>
        </div>

        {loadingList ? (
          <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>No templates yet.</p>
        ) : (
          <div className="grid grid-2 mt-2">
            {list.map(tpl => (
              <div key={tpl.id} className="card p-4">
                <div className="flex items-center gap-2">
                  <span className="badge">{new Date(tpl.created_at).toLocaleDateString()}</span>
                  <span className="badge" style={{ textTransform: "uppercase" }}>{tpl.sport}</span>
                  {tpl.is_public ? <span className="badge">Public</span> : null}
                  <div style={{ marginLeft: "auto", display:"flex", gap:8 }}>
                    <button className="btn btn-dark" onClick={() => startEditTemplate(tpl.id)}>Edit</button>
                    <button className="btn btn-dark" onClick={() => applyTemplate(tpl.id)} disabled={!athleteId}>Apply to Week</button>
                  </div>
                </div>
                <div style={{ fontWeight: 700, marginTop: 6 }}>{tpl.name}</div>
                {tpl.description ? <div style={{ color: "var(--muted)", marginTop: 2 }}>{tpl.description}</div> : null}
              </div>
            ))}
          </div>
        )}
        {applyStatus ? <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>{applyStatus}</p> : null}
      </div>

      {/* Live preview of current editor state */}
      <div className="card p-4 mt-4">
        <h4 className="text-base font-semibold">Preview (Live)</h4>
        <div className="grid grid-2 mt-2">
          {previewDays.map(({ day, items }) => (
            <div key={day} className="card p-3">
              <div className="flex items-center gap-2">
                <span className="badge">{day}</span>
                <span className="text-sm" style={{ color:"var(--muted)" }}>
                  {items.length === 0 ? "No sessions" : `${items.length} session${items.length>1?"s":""}`}
                </span>
              </div>
              {items.length > 0 && (
                <ul style={{ marginTop: 6, paddingLeft: 16 }}>
                  {items.map((it, idx) => (
                    <li key={idx} style={{ marginBottom: 6 }}>
                      <div style={{ fontWeight: 600 }}>{it.title}</div>
                      {it.details ? <div style={{ color:"var(--muted)" }}>{it.details}</div> : null}
                      <div style={{ color:"var(--muted)", fontSize: 12, marginTop: 2 }}>
                        {it.duration_min ? `Duration: ${it.duration_min} min` : ""}
                        {it.duration_min && it.rpe ? " • " : ""}
                        {it.rpe ? `RPE: ${it.rpe}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
