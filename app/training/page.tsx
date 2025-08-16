// app/training/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import * as Supa from "@/lib/supabaseClient";
// Safe NavBar import
import * as NavMod from "@/components/NavBar";
const NavBar: any = (NavMod as any).default ?? (NavMod as any).NavBar ?? (() => null);

type PlanItem = {
  id: string;
  user_id: string;
  sport: "climbing" | "ski" | "mtb" | "running";
  session_date: string;       // yyyy-mm-dd
  title: string;
  details: string | null;
  duration_min: number | null;
  rpe: number | null;
  status: "planned" | "completed" | "skipped";
  created_at?: string;
};

function startOfWeekISO(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0,0,0,0);
  return x.toISOString().slice(0,10);
}
function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

function InlineWeekPicker({
  value, onChange, className,
}: { value: string; onChange: (v: string)=>void; className?: string; }) {
  const prev = () => onChange(addDaysISO(value, -7));
  const next = () => onChange(addDaysISO(value, 7));
  const onDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value ? new Date(e.target.value) : new Date();
    onChange(startOfWeekISO(v));
  };
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button className="btn btn-dark" type="button" onClick={prev}>←</button>
      <input type="date" className="field field--date" value={value} onChange={onDate}/>
      <button className="btn btn-dark" type="button" onClick={next}>→</button>
      <span className="text-sm" style={{ color: "var(--muted)" }}>
        {value} – {addDaysISO(value,6)}
      </span>
    </div>
  );
}

export default function TrainingPage() {
  const sp = useSearchParams();
  const router = useRouter();

  // Supabase client (works with factory or const export)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [sport, setSport] = useState<PlanItem["sport"]>(
    (sp?.get("sport") as any) || "climbing"
  );
  const [weekStart, setWeekStart] = useState<string>(
    sp?.get("week") || startOfWeekISO(new Date())
  );
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Load my week
  const loadWeek = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) return;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const end = addDaysISO(weekStart, 7);
      const { data, error } = await supabase
        .from("training_plan_items")
        .select("*")
        .eq("user_id", user.id)
        .eq("sport", sport)
        .gte("session_date", weekStart)
        .lt("session_date", end)
        .order("session_date", { ascending: true });
      if (error) throw error;
      setItems((data || []) as PlanItem[]);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally { setLoading(false); }
  }, [isConfigured, supabase, router, sport, weekStart]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  // Realtime refresh
  useEffect(() => {
    if (!isConfigured || !supabase) return;
    let mounted = true;
    let channel: any = null;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        channel = supabase.channel(`training-${sport}`)
          .on("postgres_changes", {
            event: "*", schema: "public", table: "training_plan_items",
            filter: `user_id=eq.${user.id}`
          }, () => { if (mounted) loadWeek(); })
          .subscribe();
      } catch {}
    })();
    return () => {
      mounted = false;
      try { if (channel) { supabase.removeChannel(channel); channel?.unsubscribe?.(); } } catch {}
    };
  }, [isConfigured, supabase, sport, loadWeek]);

  // Actions
  async function toggleStatus(id: string, current: PlanItem["status"]) {
    if (!isConfigured || !supabase) return;
    const next: PlanItem["status"] =
      current === "completed" ? "planned" : "completed";
    const { error } = await supabase.from("training_plan_items").update({ status: next }).eq("id", id);
    if (!error) setItems(prev => prev.map(it => it.id === id ? { ...it, status: next } : it));
  }
  async function setRpe(id: string, rpe: number | null) {
    if (!isConfigured || !supabase) return;
    const { error } = await supabase.from("training_plan_items").update({ rpe }).eq("id", id);
    if (!error) setItems(prev => prev.map(it => it.id === id ? { ...it, rpe } : it));
  }

  // Group by date
  const grouped = items.reduce<Record<string, PlanItem[]>>((acc, it) => {
    (acc[it.session_date] ||= []).push(it);
    return acc;
  }, {});

  // Progress
  const completed = items.filter(i => i.status === "completed").length;
  const pct = items.length ? Math.round((100 * completed) / items.length) : 0;

  return (
    <div className="max-w-5xl mx-auto pb-16">
      <NavBar />

      <div className="card p-4 mt-6">
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <div>
            <h2 className="text-xl font-semibold">My Training</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Mark sessions as completed and record RPE.
            </p>
            {note ? <p className="text-xs" style={{ color: "#fca5a5", marginTop: 6 }}>{note}</p> : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <select className="field" value={sport} onChange={e => setSport(e.target.value as any)}>
              <option value="climbing">Climbing</option>
              <option value="ski">Ski</option>
              <option value="mtb">MTB</option>
              <option value="running">Running</option>
            </select>
            <InlineWeekPicker value={weekStart} onChange={setWeekStart} />
          </div>
        </div>

        {/* progress bar */}
        <div className="mt-4">
          <div className="h-2 w-full rounded bg-white/10">
            <div className="h-2 rounded" style={{ width: `${pct}%`, background: "var(--pine, #ef4444)" }} />
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {completed}/{items.length} completed
          </div>
        </div>
      </div>

      {/* Sessions */}
      <div className="mt-6 flex flex-col gap-4">
        {loading ? (
          <div className="card p-4">Loading…</div>
        ) : items.length === 0 ? (
          <div className="card p-4" style={{ color: "var(--muted)" }}>
            No sessions for this week.
          </div>
        ) : (
          Object.keys(grouped).sort().map(day => (
            <div key={day} className="card p-4">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{new Date(day).toLocaleDateString()}</h3>
                <span className="badge ml-2">{sport}</span>
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {grouped[day].map(it => (
                  <div key={it.id} className="card p-3">
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-dark"
                        type="button"
                        onClick={() => toggleStatus(it.id, it.status)}
                        title="Toggle complete"
                      >
                        {it.status === "completed" ? "✓ Completed" : "Mark Complete"}
                      </button>
                      <div className="font-medium truncate">{it.title}</div>
                      <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
                        {it.duration_min != null ? `${it.duration_min} min` : "—"}
                      </div>
                    </div>
                    {it.details && (
                      <div className="text-sm mt-1 whitespace-pre-wrap">{it.details}</div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs" style={{ color: "var(--muted)" }}>RPE:</span>
                      <input
                        className="field w-20"
                        type="number"
                        min={1} max={10}
                        placeholder="1–10"
                        value={it.rpe ?? ""}
                        onChange={e => setRpe(it.id, e.target.value === "" ? null : Number(e.target.value))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
