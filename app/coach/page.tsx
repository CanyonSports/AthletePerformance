// app/coach/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Users, Mail, CalendarDays, Target, CheckCircle, AlertCircle,
  ChevronDown, ChevronRight
} from "lucide-react";

/* ---------- Types ---------- */
type Role = "athlete" | "coach" | "admin";

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: Role | null;
};

type WeekSummary = {
  scheduledCount: number;
  completedCount: number;
  minutesScheduled: number;
  minutesCompleted: number;
  lastCompleted: string | null;
};

type MessageRow = {
  id: string;
  athlete_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

/* ---------- Small utils ---------- */
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in (e as any) && typeof (e as any).message === "string") {
    return (e as any).message as string;
  }
  try { return JSON.stringify(e); } catch { return String(e); }
}
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

/** Small inline week picker */
function InlineWeekPicker({
  value, onChange, className,
}: { value: string; onChange: (v: string) => void; className?: string; }) {
  const prev = () => onChange(addDaysISO(value, -7));
  const next = () => onChange(addDaysISO(value, 7));
  const handleDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value ? new Date(e.target.value) : new Date();
    onChange(startOfWeekISO(v));
  };
  const label = `${value} – ${addDaysISO(value, 6)}`;
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button type="button" className="btn btn-dark" onClick={prev}>←</button>
      <input type="date" className="field field--date" value={value} onChange={handleDate} />
      <button type="button" className="btn btn-dark" onClick={next}>→</button>
      <span className="text-xs sm:text-sm" style={{ color: "var(--muted)" }}>{label}</span>
    </div>
  );
}

/* ---------- Page ---------- */
export default function CoachDashboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => { try { return getSupabase(); } catch { return null; } }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [me, setMe] = useState<Profile | null>(null);

  const [athletes, setAthletes] = useState<Profile[]>([]);
  const [summaries, setSummaries] = useState<Record<string, WeekSummary>>({});
  const [weekStart, setWeekStart] = useState<string>(startOfWeekISO(new Date()));
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);

  // Inbox
  const [inboxOpen, setInboxOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [recentMessages, setRecentMessages] = useState<MessageRow[]>([]);

  const guardText =
    !me ? "" :
    (me.role === "coach" || me.role === "admin") ? "" :
    "You are not a coach. Ask an admin to set your role.";

  /* ---------- Load current user + gate route ---------- */
  const loadMeAndAthletes = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) { setNote("Supabase env not set."); return; }
    setLoadingList(true);
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) { router.replace("/login"); return; }

      const { data: meRow, error: meErr } = await supabase
        .from("profiles")
        .select("id,email,display_name,role")
        .eq("id", user.id)
        .maybeSingle();

      if (meErr) { setNote(getErrorMessage(meErr)); return; }
      if (!meRow) { setNote("No profile found for your account."); return; }
      setMe(meRow as Profile);

      if (meRow.role !== "coach" && meRow.role !== "admin") {
        router.replace("/dashboard");
        return;
      }

      const { data: links, error: linkErr } = await supabase
        .from("coach_athletes")
        .select("athlete_id")
        .eq("coach_id", user.id);

      if (linkErr) { setNote(getErrorMessage(linkErr)); return; }

      const ids = (links ?? []).map((l: any) => l.athlete_id);
      if (ids.length === 0) { setAthletes([]); setSummaries({}); return; }

      const { data: profs, error: profErr } = await supabase
        .from("profiles")
        .select("id,email,display_name,role")
        .in("id", ids);

      if (profErr) { setNote(getErrorMessage(profErr)); return; }

      const sorted = (profs ?? []).slice().sort((a, b) =>
        (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "")
      );
      setAthletes(sorted as Profile[]);
    } catch (e) {
      setNote(getErrorMessage(e));
    } finally {
      setLoadingList(false);
    }
  }, [isConfigured, supabase, router]);

  useEffect(() => { loadMeAndAthletes(); }, [loadMeAndAthletes]);

  /* ---------- Weekly summaries (no sport filter) ---------- */
  const fetchSummaries = useCallback(async () => {
    if (!isConfigured || !supabase || athletes.length === 0) { setSummaries({}); return; }
    setLoadingStats(true);
    const end = addDaysISO(weekStart, 7);
    const results: Record<string, WeekSummary> = {};

    try {
      await Promise.all(
        athletes.map(async (a) => {
          const { data, error } = await supabase
            .from("training_plan_items")
            .select("status,duration_min,session_date")
            .eq("user_id", a.id)
            .gte("session_date", weekStart)
            .lt("session_date", end);

          if (error) {
            results[a.id] = {
              scheduledCount: 0,
              completedCount: 0,
              minutesScheduled: 0,
              minutesCompleted: 0,
              lastCompleted: null,
            };
            return;
          }

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
    } catch (e) {
      setNote(getErrorMessage(e));
    } finally {
      setLoadingStats(false);
    }
  }, [isConfigured, supabase, athletes, weekStart]);

  useEffect(() => { fetchSummaries(); }, [fetchSummaries]);

  /* ---------- Inbox ---------- */
  const loadInbox = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // unread count
      const unread = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", user.id)
        .is("read_at", null);
      if (!unread.error) setUnreadCount(unread.count ?? 0);

      // recent messages
      const res = await supabase
        .from("messages")
        .select("*")
        .eq("recipient_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!res.error) setRecentMessages((res.data ?? []) as MessageRow[]);
    } catch (e) {
      // show but don't kill page
      setNote(getErrorMessage(e));
    }
  }, [isConfigured, supabase]);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  /* ---------- Realtime: messages + links ---------- */
  useEffect(() => {
    if (!isConfigured || !supabase) return;
    let mounted = true;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const ch = supabase
        .channel("coach-dashboard")
        .on("postgres_changes",
          { event: "*", schema: "public", table: "messages", filter: `recipient_id=eq.${user.id}` },
          () => { if (mounted) { loadInbox(); } }
        )
        .on("postgres_changes",
          { event: "*", schema: "public", table: "coach_athletes", filter: `coach_id=eq.${user.id}` },
          () => { if (mounted) { loadMeAndAthletes(); fetchSummaries(); } }
        )
        .subscribe();

      return () => { try { supabase.removeChannel(ch); } catch {} };
    })();

    return () => { mounted = false; };
  }, [isConfigured, supabase, loadInbox, loadMeAndAthletes, fetchSummaries]);

  /* ---------- Derived: quick view metrics ---------- */
  const filtered = athletes.filter(a => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const name = (a.display_name ?? "").toLowerCase();
    const email = (a.email ?? "").toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  const totals = useMemo(() => {
    const ids = Object.keys(summaries);
    let scheduled = 0, completed = 0, minSched = 0, minComp = 0, activeAthletes = 0;
    ids.forEach(id => {
      const s = summaries[id];
      scheduled += s.scheduledCount;
      completed += s.completedCount;
      minSched += s.minutesScheduled;
      minComp += s.minutesCompleted;
      if (s.scheduledCount > 0) activeAthletes += 1;
    });
    const compliance = scheduled > 0 ? Math.round((100 * completed) / scheduled) : 0;
    return { scheduled, completed, minSched, minComp, activeAthletes, compliance };
  }, [summaries]);

  const lowComplianceAthletes = useMemo(() => {
    // Show bottom 5 athletes with at least 2 scheduled and <60% done
    const rows = Object.entries(summaries)
      .map(([id, s]) => ({ id, ...s, pct: s.scheduledCount ? Math.round(100 * s.completedCount / s.scheduledCount) : 0 }))
      .filter(r => r.scheduledCount >= 2)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);
    return rows;
  }, [summaries]);

  const thisWeekLabel = useMemo(() => {
    return `${new Date(weekStart).toLocaleDateString()} – ${new Date(addDaysISO(weekStart, 6)).toLocaleDateString()}`;
  }, [weekStart]);

  /* ---------- Rendering helpers ---------- */
  function displayName(p: Profile) {
    return p.display_name || p.email || p.id.slice(0, 8);
  }
  function openAthlete(id: string) {
    const params = new URLSearchParams({ week: weekStart });
    router.push(`/coach-console/${id}?${params.toString()}`);
  }

  /* ---------- UI ---------- */
  return (
    <div className="max-w-7xl mx-auto pb-16">
      <NavBar />

      {/* Hero/Header */}
      <div className="mt-4 rounded-2xl p-5 md:p-6"
           style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
        <div className="flex items-start gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Coach Dashboard</h1>
            <p className="text-sm md:text-base mt-1" style={{ color: "var(--muted)" }}>
              Manage athletes and sessions for the week of {thisWeekLabel}.
            </p>
          </div>
          <div className="ml-auto">
            <InlineWeekPicker value={weekStart} onChange={setWeekStart} />
          </div>
        </div>

        {/* Quick View metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mt-4">
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10"><Users className="w-5 h-5" /></div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>Athletes</div>
                <div className="text-xl font-semibold">{athletes.length}</div>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10"><CheckCircle className="w-5 h-5" /></div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>Active This Week</div>
                <div className="text-xl font-semibold">{totals.activeAthletes}</div>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10"><Target className="w-5 h-5" /></div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>Weekly Compliance</div>
                <div className="text-xl font-semibold">{totals.compliance}%</div>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10"><CalendarDays className="w-5 h-5" /></div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>Sessions This Week</div>
                <div className="text-xl font-semibold">{totals.scheduled}</div>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10"><CheckCircle className="w-5 h-5" /></div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>Minutes Done / Planned</div>
                <div className="text-xl font-semibold">
                  {totals.minComp} / {totals.minSched}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Alert/guard + notes */}
        {(guardText || note) && (
          <div className="mt-3 text-xs">
            {guardText ? <div style={{ color: "#fca5a5" }}>{guardText}</div> : null}
            {note ? <div style={{ color: "#fca5a5" }}>{note}</div> : null}
          </div>
        )}
      </div>

      {/* Inbox */}
      <div className="mt-6 card p-4">
        <button
          className="w-full text-left flex items-center gap-2"
          onClick={() => setInboxOpen(v => !v)}
          aria-expanded={inboxOpen}
        >
          {inboxOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="font-semibold">Coach Inbox</span>
          {unreadCount > 0 && (
            <span className="ml-2 inline-flex items-center justify-center text-xs rounded-full px-2 py-0.5"
                  style={{ background: "rgba(16,185,129,0.15)", color: "rgb(16,185,129)" }}>
              {unreadCount} new
            </span>
          )}
          <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
            {inboxOpen ? "Hide" : "Show"}
          </span>
        </button>

        {inboxOpen && (
          <div className="mt-3 space-y-2">
            {recentMessages.length === 0 ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>No messages yet.</div>
            ) : recentMessages.map((m) => (
              <div key={m.id} className="rounded bg-white/5 p-2 flex items-start gap-2">
                <div className="flex-1">
                  <div className="text-xs opacity-80">
                    {new Date(m.created_at).toLocaleString()}
                    {m.read_at == null ? <span className="ml-2 text-xs" style={{ color: "rgb(16,185,129)" }}>• new</span> : null}
                  </div>
                  <div className="text-sm mt-1 line-clamp-2">{m.body}</div>
                </div>
                <Link
                  href={`/coach-console/${m.athlete_id}?focusMessageId=${m.id}`}
                  className="btn btn-dark"
                  title="Open in athlete console"
                >
                  Open
                </Link>
              </div>
            ))}
            <div className="pt-2">
              <Link href="/coach/inbox" className="btn">Go to Inbox</Link>
            </div>
          </div>
        )}
      </div>

      {/* Attention: low compliance */}
      {lowComplianceAthletes.length > 0 && (
        <div className="mt-6 card p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-400" />
            <h3 className="font-semibold">Needs Attention</h3>
            <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>(lowest weekly compliance)</span>
          </div>
          <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lowComplianceAthletes.map((r) => {
              const who = athletes.find(a => a.id === r.id);
              const name = who ? displayName(who) : r.id.slice(0, 8);
              const pct = r.pct;
              const barWidth = `${Math.min(100, Math.max(0, pct))}%`;
              return (
                <button
                  key={r.id}
                  className="card p-3 text-left hover:shadow-lg transition"
                  onClick={() => openAthlete(r.id)}
                >
                  <div className="flex items-center gap-2">
                    <div className="font-medium truncate">{name}</div>
                    <span className="ml-auto text-sm">{pct}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full rounded bg-white/10">
                    <div className="h-2 rounded" style={{ width: barWidth, background: "var(--pine,#ef4444)" }} />
                  </div>
                  <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                    {r.completedCount}/{r.scheduledCount} done • {r.minutesCompleted}/{r.minutesScheduled} min
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Athletes list */}
      <div className="mt-6 card p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Your Athletes</h3>
          <span className="text-sm ml-auto" style={{ color: "var(--muted)" }}>
            Week of {new Date(weekStart).toLocaleDateString()}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search athletes…"
            className="field"
          />
          {(loadingList || loadingStats) && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>Refreshing…</span>
          )}
        </div>

        {athletes.length === 0 ? (
          <div className="text-sm mt-4" style={{ color: "var(--muted)" }}>
            You have no linked athletes yet.
          </div>
        ) : (
          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((a) => {
              const s = summaries[a.id];
              const pct = s && s.scheduledCount > 0
                ? Math.round((100 * s.completedCount) / s.scheduledCount)
                : 0;
              const barWidth = `${Math.min(100, Math.max(0, pct))}%`;
              return (
                <button
                  key={a.id}
                  className="card p-4 text-left hover:shadow-lg transition"
                  onClick={() => openAthlete(a.id)}
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
                      {(displayName(a)[0] || "?").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{displayName(a)}</div>
                      <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
                        {a.email ?? "No email"}
                      </div>
                    </div>
                    <div className="ml-auto text-sm">{pct}%</div>
                  </div>

                  <div className="mt-3 h-2 w-full rounded bg-white/10">
                    <div className="h-2 rounded" style={{ width: barWidth, background: "var(--pine, #ef4444)" }} />
                  </div>

                  <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                    This week: <strong>{s?.scheduledCount ?? 0}</strong> planned •{" "}
                    <strong>{s?.completedCount ?? 0}</strong> done •{" "}
                    <strong>{s?.minutesCompleted ?? 0}</strong>/<strong>{s?.minutesScheduled ?? 0}</strong> min
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
