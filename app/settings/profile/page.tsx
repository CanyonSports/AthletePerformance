// app/settings/profile/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";
import Link from "next/link";

type Details = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  dob: string | null;
  sex: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  resting_hr: number | null;
  max_hr: number | null;
  medical_notes: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
};

export default function ProfileSettingsPage() {
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [meId, setMeId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [form, setForm] = useState<Details | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      setLoading(true); setNote("");
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setNote("Please sign in."); setLoading(false); return; }
        setMeId(user.id);
        setEmail(user.email ?? null);

        const res = await supabase.from("athlete_details").select("*").eq("user_id", user.id).maybeSingle();
        if (res.error) throw res.error;
        if (res.data) {
          setForm(res.data as Details);
        } else {
          setForm({
            user_id: user.id,
            first_name: null,
            last_name: null,
            phone: null,
            dob: null,
            sex: null,
            height_cm: null,
            weight_kg: null,
            resting_hr: null,
            max_hr: null,
            medical_notes: null,
            emergency_name: null,
            emergency_phone: null,
          });
        }
      } catch (e: any) {
        setNote(e.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase]);

  function upd<K extends keyof Details>(key: K, val: Details[K]) {
    if (!form) return;
    setForm({ ...form, [key]: val });
  }

  async function save() {
    if (!supabase || !form || !meId) return;
    setSaving(true); setNote("");
    try {
      // Upsert by user_id primary key
      const { error } = await supabase.from("athlete_details").upsert(form, { onConflict: "user_id" });
      if (error) throw error;
      setNote("Saved.");
      setTimeout(() => setNote(""), 1200);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto pb-20">
      <div className="mt-6 card p-4">
        <div className="flex items-center gap-2" style={{flexWrap:"wrap"}}>
          <Link href="/training" className="btn">← Back</Link>
          <div>
            <div className="text-xs" style={{color:"var(--muted)"}}>Settings</div>
            <h1 className="text-xl font-semibold">Profile & Health</h1>
          </div>
          <div className="ml-auto text-sm" style={{color:"var(--muted)"}}>{email || ""}</div>
        </div>
        {note ? <div className="text-xs mt-2" style={{color: note === "Saved." ? "#34d399" : "#fca5a5"}}>{note}</div> : null}
      </div>

      {loading || !form ? (
        <div className="mt-4 card p-4">Loading…</div>
      ) : (
        <div className="mt-4 card p-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>First Name</div>
              <input className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                     value={form.first_name ?? ""} onChange={e=>upd("first_name", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Last Name</div>
              <input className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                     value={form.last_name ?? ""} onChange={e=>upd("last_name", e.target.value || null)} />
            </div>

            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Phone</div>
              <input className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                     value={form.phone ?? ""} onChange={e=>upd("phone", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Date of Birth</div>
              <input type="date" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                     value={form.dob ?? ""} onChange={e=>upd("dob", e.target.value || null)} />
            </div>

            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Sex</div>
              <select className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                      value={form.sex ?? ""} onChange={e=>upd("sex", e.target.value || null)}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="nonbinary">Non-binary</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Height (cm)</div>
              <input inputMode="numeric" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                     value={form.height_cm ?? ""} onChange={e=>upd("height_cm", e.target.value ? Number(e.target.value.replace(/\D/g,"")) : null)} />
            </div>
            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Weight (kg)</div>
              <input inputMode="numeric" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                     value={form.weight_kg ?? ""} onChange={e=>upd("weight_kg", e.target.value ? Number(e.target.value.replace(/\D/g,"")) : null)} />
            </div>

            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Resting HR (bpm)</div>
              <input inputMode="numeric" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                     value={form.resting_hr ?? ""} onChange={e=>upd("resting_hr", e.target.value ? Number(e.target.value.replace(/\D/g,"")) : null)} />
            </div>
            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Max HR (bpm)</div>
              <input inputMode="numeric" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                     value={form.max_hr ?? ""} onChange={e=>upd("max_hr", e.target.value ? Number(e.target.value.replace(/\D/g,"")) : null)} />
            </div>

            <div className="md:col-span-2 space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Medical Notes</div>
              <textarea rows={3} className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                        value={form.medical_notes ?? ""} onChange={e=>upd("medical_notes", e.target.value || null)} />
            </div>

            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Emergency Contact Name</div>
              <input className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                     value={form.emergency_name ?? ""} onChange={e=>upd("emergency_name", e.target.value || null)} />
            </div>
            <div className="space-y-1">
              <div className="text-xs" style={{color:"var(--muted)"}}>Emergency Contact Phone</div>
              <input className="w-full px-3 py-2 rounded bg-white/5 border border-white/10"
                     value={form.emergency_phone ?? ""} onChange={e=>upd("emergency_phone", e.target.value || null)} />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button className="btn btn-dark" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            {note ? <span className="text-xs" style={{color: note==="Saved." ? "#34d399" : "#fca5a5"}}>{note}</span> : null}
          </div>
        </div>
      )}
    </div>
  );
}
