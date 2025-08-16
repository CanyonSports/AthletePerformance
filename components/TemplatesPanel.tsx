// components/TemplatesPanel.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";

type Sport = "climbing" | "ski" | "mtb" | "running";

type TemplateRow = {
  id: string;
  name: string;
  sport: Sport;
  scope: "week" | "session";
  created_at: string;
};

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromYMD(iso: string) {
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, (m??1)-1, d??1, 12,0,0,0);
}

export default function TemplatesPanel({
  athleteId,
  sport,
  weekStart,
  onApplied,
}: {
  athleteId: string | null;
  sport: Sport;
  weekStart: string;                 // yyyy-mm-dd (local)
  onApplied?: () => void;
}) {
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [meId, setMeId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tpls, setTpls] = useState<TemplateRow[]>([]);
  const [search, setSearch] = useState("");

  // Save-week form
  const [tplName, setTplName] = useState("");
  const [saving, setSaving] = useState(false);

  // Apply form
  const [applyDate, setApplyDate] = useState(weekStart);
  const [replace, setReplace] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // Load me + my templates
  const loadAll = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setNote("Sign in required."); return; }
      setMeId(user.id);

      const q = supabase
        .from("training_templates")
        .select("id,name,sport,scope,created_at")
        .eq("coach_id", user.id)
        .order("created_at", { ascending: false });

      const { data, error } = await q;
      if (error) throw error;
      setTpls((data || []) as TemplateRow[]);
    } catch (e:any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function saveWeekAsTemplate(){
    setNote("");
    if (!isConfigured || !supabase) return;
    if (!meId) return;
    if (!athleteId) { setNote("Select an athlete first."); return; }
    if (!tplName.trim()) { setNote("Enter a template name."); return; }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("save_week_as_template", {
        p_coach_id: meId,
        p_user_id: athleteId,
        p_week_start: weekStart,
        p_sport: sport,
        p_name: tplName.trim()
      });
      if (error) throw error;
      setTplName("");
      await loadAll();
      setNote("Saved week as template.");
    } catch (e:any) {
      setNote(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function applyTemplate(id: string){
    setNote("");
    if (!isConfigured || !supabase) return;
    if (!athleteId) { setNote("Select an athlete first."); return; }

    setApplyingId(id);
    try {
      const { data, error } = await supabase.rpc("apply_template_to_week", {
        p_template_id: id,
        p_user_id: athleteId,
        p_week_start: applyDate,
        p_replace: replace
      });
      if (error) throw error;
      setNote(`Applied template. Sessions: ${data ?? 0}`);
      onApplied?.();
    } catch (e:any) {
      setNote(e.message ?? String(e));
    } finally {
      setApplyingId(null);
    }
  }

  async function deleteTemplate(id: string){
    if (!isConfigured || !supabase) return;
    if (!confirm("Delete this template? This cannot be undone.")) return;
    try {
      const { error } = await supabase.from("training_templates").delete().eq("id", id);
      if (error) throw error;
      setTpls(prev => prev.filter(t => t.id !== id));
    } catch (e:any) {
      setNote(e.message ?? String(e));
    }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return tpls.filter(t =>
      (t.sport === sport) &&
      (!s || t.name.toLowerCase().includes(s))
    );
  }, [tpls, sport, search]);

  return (
    <div className="card p-4 mt-4">
      <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
        <h3 className="font-semibold">Templates</h3>
        {note ? <span className="text-xs" style={{ color: "#fca5a5" }}>{note}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          <input
            className="field"
            placeholder={`Search ${sport} templates…`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <input
            type="date"
            className="field"
            value={applyDate}
            onChange={e => setApplyDate(e.target.value || ymd(new Date()))}
            title="Apply to week starting on…"
          />
          <label className="text-sm inline-flex items-center gap-2">
            <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
            Replace week
          </label>
        </div>
      </div>

      {/* Save current week */}
      <div className="mt-3 rounded border border-white/10 p-3">
        <div className="text-sm opacity-80">Save current week as template</div>
        <div className="mt-2 flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <input
            className="field flex-1"
            placeholder={`Template name (e.g., Base Build Week)`}
            value={tplName}
            onChange={e => setTplName(e.target.value)}
          />
          <button className="btn btn-dark" disabled={saving || !athleteId} onClick={saveWeekAsTemplate}>
            {saving ? "Saving…" : "Save Week"}
          </button>
        </div>
        {!athleteId ? <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>Pick an athlete above first.</div> : null}
      </div>

      {/* List */}
      <div className="mt-4 grid grid-3">
        {filtered.length === 0 ? (
          <div className="text-sm opacity-70">No templates yet. Save the current week to create one.</div>
        ) : filtered.map(t => (
          <div key={t.id} className="rounded border border-white/10 p-3">
            <div className="flex items-center gap-2">
              <div className="text-xs px-2 py-0.5 rounded bg-white/10">{t.sport.toUpperCase()}</div>
              <div className="font-semibold truncate">{t.name}</div>
              <div className="ml-auto text-xs opacity-70">
                {new Date(t.created_at).toLocaleDateString()}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                className="btn btn-dark"
                onClick={() => applyTemplate(t.id)}
                disabled={!athleteId || applyingId === t.id}
                title="Apply to selected athlete & week"
              >
                {applyingId === t.id ? "Applying…" : "Apply → Week"}
              </button>
              <button className="btn" onClick={() => deleteTemplate(t.id)}>Delete</button>
            </div>
            {!athleteId ? <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>Pick an athlete to enable Apply.</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
