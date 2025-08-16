// app/coach-console/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import * as Supa from "@/lib/supabaseClient";

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "athlete" | "coach" | "admin" | null;
};

type WeekSummary = {
  scheduledCount: number;
  completedCount: number;
  minutesScheduled: number;
  minutesCompleted: number;
  lastCompleted: string | null;
};

function startOfWeekISO(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inline week picker (kept local to avoid import/export mismatches) */
function InlineWeekPicker({
  value, onChange, className,
}: { value: string; onChange: (v: string) => void; className?: string; }) {
  const rangeLabel = `${value} – ${addDaysISO(value, 6)}`;
  const prev = () => onChange(addDaysISO(value, -7));
  const next = () => onChange(addDaysISO(value, 7));
  const handleDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value ? new Date(e.target.value) : new Date();
    onChange(startOfWeekISO(v));
  };
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button type="button" className="btn btn-dark" onClick={prev}>←</button>
      <input type="date" className="field field--date" value={value} onChange={handleDate} />
      <button type="button" className="btn btn-dark" onClick={next}>→</button>
      <span className="text-sm" style={{ color: "var(--muted)" }}>{rangeLabel}</span>
    </div>
  );
}

export default function CoachOverviewPage() {
  const router = useRouter();

  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [me, setMe] = useState<Profile | null>(null);
  const [athletes, setAthletes] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");
  const [sport, setSport] = useState<"climbing" | "ski" | "mtb" | "running">("climbing");
  const [weekStart, setWeekStart] = useState<string>(startOfWeekISO(new Date()));
  const [summaries, setSummaries] = useState<Record<string, WeekSummary>>({});

  const load = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) { setNote("Supabase env not set."); return; }
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) { setNote("Please sign in."); return; }

      const { data: meRow, error: meErr } = await supabase
        .from("profiles").select("*").eq("id", user.id).single();
      if (meErr) throw meErr;
      setMe(meRow as Profile);

      const { data: links, error: linkErr } = await supabase
        .from("coach_athletes").select("athlete_id").eq("coach_id", user.id);
      if (linkErr) throw linkErr;

      const ids = (links ?? []).map((l: any) => l.athlete_id);
      if (ids.length === 0) { setAthletes([]); setSummaries({}); return; }

      const { data: profs, error: profErr } = await supabase
        .from("profiles").select("*").in("id", ids);
      if (profErr) throw profErr;

      setAthletes((profs ?? []) as Profile[]);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase]);

  useEffect(() => { load(); }, [load]);

  const fetchSummaries = useCallback(async () => {
    if (!isConfigured || !supabase || athletes.length === 0) { setSummaries({}); return; }
    const end = addDaysISO(weekStart, 7);
    const results: Record<string, WeekSummary> = {};

    await Promise.all(
      athletes.map(async (a) => {
        const { data, error } = await supabase
          .from("training_plan_items")
          .select("status,duration_min,session_date")
          .eq("user_id", a.id)
          .eq("sport", sport)
          .gte("session_date", weekStart)
          .lt("session_date", end);
        if (error) return;

        const rows = (data ?? []) as any[];
        let completedCount = 0;
        let minutesCompleted = 0;
        let lastCompleted: string | null = null;

        for (const r of rows) {
          if (r.status === "completed") {
            completedCount++;
            minutesCompleted += (r.duration_min ?? 0);
            if (!lastCompleted || r.session_date > lastCompleted) lastCompleted = r.session_date;
          }
        }
        const minutesScheduled = rows.reduce((acc, r) => acc + (r.duration_min ?? 0), 0);
        results[a.id] = {
          scheduledCount: rows.length,
          completedCount,
          minutesScheduled,
          minutesCompleted,
          lastCompleted,
        };
      })
    );
    setSummaries(results);
  }, [isConfigured, supabase, athletes, sport, weekStart]);

  useEffect(() => { fetchSummaries(); }, [fetchSummaries]);

  const filtered = athletes.filter(a => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const name = (a.display_name ?? "").toLowerCase();
    const email = (a.email ?? "").toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  function openAthlete(id: string) {
    const params = new URLSearchParams({ sport, week: weekStart });
    // 👇 route now points at /coach-console/[athleteId]
    router.push(`/coach-console/${id}?${params.toString()}`);
  }

  const guard =
    !me ? "Loading profile…" :
    (me.role === "coach" || me.role === "admin") ? "" :
    "You are not a coach. Ask an admin to set your role.";

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <NavBar />

      <div className="card p-4 mt-6">
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <div>
            <h2 className="text-xl font-semibold">Coach Console — Athletes</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Select an athlete to open and edit their weekly plan.
            </p>
            {guard ? <p className="text-xs" style={{ color: "#fca5a5", marginTop: 6 }}>{guard}</p> : null}
            {note ? <p className="text-xs" style={{ color: "#fca5a5", marginTop: 6 }}>{note}</p> : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search athletes…"
              className="field"
            />
            <select className="field" value={sport} onChange={e => setSport(e.target.value as any)}>
              <option value="climbing">Climbing</option>
              <option value="ski">Ski</option>
              <option value="mtb">MTB</option>
              <option value="running">Running</option>
            </select>

            <InlineWeekPicker value={weekStart} onChange={setWeekStart} />
          </div>
        </div>
      </div>

      {/* Athlete grid */}
      <div className="grid grid-3 mt-6">
        {filtered.length === 0 ? (
          <div className="card p-6" style={{ gridColumn: "1 / -1" }}>
            <p style={{ color: "var(--muted)" }}>
              No linked athletes yet. Share an invite from the Coach Console or add by email.
            </p>
          </div>
        ) : (
          filtered.map((a) => {
            const label = a.display_name || a.email || a.id;
            const initial = (a.display_name?.[0] || a.email?.[0] || "?").toUpperCase();
            const s = summaries[a.id];
            const pct = s && s.scheduledCount > 0 ? Math.round((100 * s.completedCount) / s.scheduledCount) : 0;
            const barWidth = `${Math.min(100, Math.max(0, pct))}%`;

            return (
              <button
                key={a.id}
                className="card p-4 hover:shadow-lg transition"
                onClick={() => openAthlete(a.id)}
                style={{ textAlign: "left" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex items-center justify-center"
                    style={{
                      width: 44, height: 44, borderRadius: 12,
                      background: "linear-gradient(180deg,#1f2937,#111827)",
                      color: "#fff", fontWeight: 700, fontSize: 18
                    }}
                  >
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{label}</div>
                    <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
                      {a.email ?? "No email"}
                    </div>
                  </div>
                  <div className="ml-auto">
                    <span className="badge">{sport}</span>
                  </div>
                </div>

                {/* Mini stats */}
                <div className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                  {s ? (
                    <>
                      <div>This week: <strong>{s.scheduledCount}</strong> planned • <strong>{s.completedCount}</strong> done</div>
                      <div>Minutes: <strong>{s.minutesScheduled}</strong> planned • <strong>{s.minutesCompleted}</strong> done</div>
                      {s.lastCompleted && <div>Last completed: {s.lastCompleted}</div>}
                    </>
                  ) : (
                    <div>Loading stats…</div>
                  )}
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className="h-2 w-full rounded bg-white/10">
                    <div className="h-2 rounded" style={{ width: barWidth, background: "var(--pine, #ef4444)" }} />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
