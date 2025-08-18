// app/coach/page.tsx (Revamped "Best Coaching Dashboard")
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Users,
  Mail,
  CalendarDays,
  Target,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  Download,
  Filter,
  Star,
  StarOff,
  Clock,
  MessageSquarePlus,
  RefreshCw,
} from "lucide-react";

/* -------------------------------- Types -------------------------------- */

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

/* ------------------------------ Small utils ----------------------------- */
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in (e as any) && typeof (e as any).message === "string") {
    return (e as any).message as string;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
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
function isoToday() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t.toISOString().slice(0, 10);
}

/** Small inline week picker */
function InlineWeekPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const prev = () => onChange(addDaysISO(value, -7));
  const next = () => onChange(addDaysISO(value, 7));
  const handleDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value ? new Date(e.target.value) : new Date();
    onChange(startOfWeekISO(v));
  };
  const label = `${value} – ${addDaysISO(value, 6)}`;
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button type="button" className="btn btn-dark" onClick={prev} aria-label="Previous Week">
        ←
      </button>
      <input type="date" className="field field--date" value={value} onChange={handleDate} />
      <button type="button" className="btn btn-dark" onClick={next} aria-label="Next Week">
        →
      </button>
      <span className="text-xs sm:text-sm" style={{ color: "var(--muted)" }}>
        {label}
      </span>
    </div>
  );
}

/* ------------------------------ Main Page ------------------------------ */
export default function CoachDashboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => {
    try {
      return getSupabase();
    } catch {
      return null;
    }
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [me, setMe] = useState<Profile | null>(null);

  const [athletes, setAthletes] = useState<Profile[]>([]);
  const [summaries, setSummaries] = useState<Record<string, WeekSummary>>({});
  const [weekStart, setWeekStart] = useState<string>(startOfWeekISO(new Date()));
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Selection / UX state
  const [selected, setSelected] = useState<string[]>([]);
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [pinned, setPinned] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<"name" | "compliance" | "lastCompleted">("compliance");
  const [minScheduledCutoff, setMinScheduledCutoff] = useState(0);

  // Inbox
  const [inboxOpen, setInboxOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [recentMessages, setRecentMessages] = useState<MessageRow[]>([]);

  const guardText = !me
    ? ""
    : me.role === "coach" || me.role === "admin"
    ? ""
    : "You are not a coach. Ask an admin to set your role.";

  /* --------------- Local persistence for pins & filters --------------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("coachPins");
      if (raw) setPinned(JSON.parse(raw));
      const only = localStorage.getItem("coachOnlyPinned");
      if (only) setOnlyPinned(JSON.parse(only));
      const sKey = localStorage.getItem("coachSortKey");
      if (sKey) setSortKey(sKey as any);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("coachPins", JSON.stringify(pinned));
      localStorage.setItem("coachOnlyPinned", JSON.stringify(onlyPinned));
      localStorage.setItem("coachSortKey", sortKey);
    } catch {}
  }, [pinned, onlyPinned, sortKey]);

  /* ---------- Load current user + gate route ---------- */
  const loadMeAndAthletes = useCallback(async () => {
    setNote("");
    if (!isConfigured || !supabase) {
      setNote("Supabase env not set.");
      return;
    }
    setLoadingList(true);
    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: meRow, error: meErr } = await supabase
        .from("profiles")
        .select("id,email,display_name,role")
        .eq("id", user.id)
        .maybeSingle();

      if (meErr) {
        setNote(getErrorMessage(meErr));
        return;
      }
      if (!meRow) {
        setNote("No profile found for your account.");
        return;
      }
      setMe(meRow as Profile);

      if (meRow.role !== "coach" && meRow.role !== "admin") {
        router.replace("/dashboard");
        return;
      }

      const { data: links, error: linkErr } = await supabase
        .from("coach_athletes")
        .select("athlete_id")
        .eq("coach_id", user.id);

      if (linkErr) {
        setNote(getErrorMessage(linkErr));
        return;
      }

      const ids = (links ?? []).map((l: any) => l.athlete_id);
      if (ids.length === 0) {
        setAthletes([]);
        setSummaries({});
        return;
      }

      const { data: profs, error: profErr } = await supabase
        .from("profiles")
        .select("id,email,display_name,role")
        .in("id", ids);

      if (profErr) {
        setNote(getErrorMessage(profErr));
        return;
      }

      const sorted = (profs ?? [])
        .slice()
        .sort((a, b) => (a.display_name || a.email || "").localeCompare(b.display_name || b.email || ""));
      setAthletes(sorted as Profile[]);
    } catch (e) {
      setNote(getErrorMessage(e));
    } finally {
      setLoadingList(false);
    }
  }, [isConfigured, supabase, router]);

  useEffect(() => {
    loadMeAndAthletes();
  }, [loadMeAndAthletes]);

  /* ---------- Weekly summaries (no sport filter) ---------- */
  const fetchSummaries = useCallback(async () => {
    if (!isConfigured || !supabase || athletes.length === 0) {
      setSummaries({});
      return;
    }
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
              minutesCompleted += r.duration_min ?? 0;
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

  useEffect(() => {
    fetchSummaries();
  }, [fetchSummaries]);

  /* ------------------------------ Realtime ------------------------------ */
  useEffect(() => {
    if (!isConfigured || !supabase) return;
    let mounted = true;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const ch = supabase
        .channel("coach-dashboard")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages", filter: `recipient_id=eq.${user.id}` },
          () => {
            if (mounted) {
              loadInbox();
            }
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "coach_athletes", filter: `coach_id=eq.${user.id}` },
          () => {
            if (mounted) {
              loadMeAndAthletes();
              fetchSummaries();
            }
          }
        )
        .subscribe();

      return () => {
        try {
          supabase.removeChannel(ch);
        } catch {}
      };
    })();

    return () => {
      mounted = false;
    };
  }, [isConfigured, supabase, loadMeAndAthletes, fetchSummaries]);

  /* ------------------------------- Inbox ------------------------------- */
  const loadInbox = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const unread = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", user.id)
        .is("read_at", null);
      if (!unread.error) setUnreadCount(unread.count ?? 0);

      const res = await supabase
        .from("messages")
        .select("*")
        .eq("recipient_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!res.error) setRecentMessages((res.data ?? []) as MessageRow[]);
    } catch (e) {
      setNote(getErrorMessage(e));
    }
  }, [isConfigured, supabase]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  const markMessageRead = useCallback(
    async (id: string) => {
      if (!isConfigured || !supabase) return;
      try {
        await supabase.from("messages").update({ read_at: new Date().toISOString() }).eq("id", id);
        loadInbox();
      } catch (e) {
        setNote(getErrorMessage(e));
      }
    },
    [isConfigured, supabase, loadInbox]
  );

  /* -------------------------- Derived aggregations -------------------------- */
  const totals = useMemo(() => {
    const ids = Object.keys(summaries);
    let scheduled = 0,
      completed = 0,
      minSched = 0,
      minComp = 0,
      activeAthletes = 0;
    ids.forEach((id) => {
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

  const todayISO = isoToday();
  const inThisWeek = (iso: string) => iso >= weekStart && iso < addDaysISO(weekStart, 7);

  const riskFlags = useMemo(() => {
    // At-risk if: scheduled >=2, completed == 0 AND today is >= Wed of this week
    const wed = addDaysISO(weekStart, 2);
    const flags = new Set<string>();
    Object.entries(summaries).forEach(([id, s]) => {
      if (s.scheduledCount >= 2 && s.completedCount === 0 && todayISO >= wed) flags.add(id);
    });
    return flags;
  }, [summaries, weekStart, todayISO]);

  const lowComplianceAthletes = useMemo(() => {
    const rows = Object.entries(summaries)
      .map(([id, s]) => ({ id, ...s, pct: s.scheduledCount ? Math.round((100 * s.completedCount) / s.scheduledCount) : 0 }))
      .filter((r) => r.scheduledCount >= 2)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);
    return rows;
  }, [summaries]);

  const thisWeekLabel = useMemo(() => {
    return `${new Date(weekStart).toLocaleDateString()} – ${new Date(addDaysISO(weekStart, 6)).toLocaleDateString()}`;
  }, [weekStart]);

  /* ------------------------------ UI helpers ----------------------------- */
  function displayName(p: Profile) {
    return p.display_name || p.email || p.id.slice(0, 8);
  }
  function openAthlete(id: string) {
    const params = new URLSearchParams({ week: weekStart });
    router.push(`/coach-console/${id}?${params.toString()}`);
  }
  function isPinned(id: string) {
    return pinned.includes(id);
  }
  function togglePin(id: string) {
    setPinned((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /* ------------------------- Bulk compose messaging ------------------------- */
  const [composerOpen, setComposerOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);

  const sendMessage = useCallback(async () => {
    if (!isConfigured || !supabase || selected.length === 0 || !messageText.trim()) return;
    setSending(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");

      const rows = selected.map((athlete_id) => ({
        athlete_id,
        sender_id: user.id,
        recipient_id: athlete_id,
        body: messageText.trim(),
        created_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("messages").insert(rows);
      if (error) throw error;
      setMessageText("");
      setComposerOpen(false);
      // Encourage a refresh of the inbox for the coach (in case self-cc rules)
      loadInbox();
    } catch (e) {
      setNote(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  }, [isConfigured, supabase, selected, messageText, loadInbox]);

  /* ------------------------------ CSV Export ------------------------------ */
// Helper for older TS/JS targets without String.replaceAll
function csvEscape(s: string) {
  return (s ?? "").replace(/"/g, '""');
}

  const exportCSV = useCallback(() => {
    const header = [
      "athlete_id",
      "name",
      "email",
      "scheduled",
      "completed",
      "minutes_scheduled",
      "minutes_completed",
      "last_completed",
      "compliance_pct",
    ];
    const lines = [header.join(",")];

    const byId: Record<string, Profile> = {};
    athletes.forEach((a) => (byId[a.id] = a));

    Object.entries(summaries).forEach(([id, s]) => {
      const p = byId[id];
      const name = p ? displayName(p) : id;
      const email = p?.email ?? "";
      const pct = s.scheduledCount ? Math.round((100 * s.completedCount) / s.scheduledCount) : 0;
      const row = [
        id,
        `"${csvEscape(name)}"`,
        `"${csvEscape(email)}"`,
        s.scheduledCount,
        s.completedCount,
        s.minutesScheduled,
        s.minutesCompleted,
        s.lastCompleted ?? "",
        pct,
      ].join(",");
      lines.push(row);
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coach_week_${weekStart}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [athletes, summaries, weekStart]);

  /* -------------------------- Filtering & Sorting ------------------------- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = athletes.filter((a) => {
      const name = (a.display_name ?? "").toLowerCase();
      const email = (a.email ?? "").toLowerCase();
      const matchesQuery = !q || name.includes(q) || email.includes(q);
      const inPins = onlyPinned ? pinned.includes(a.id) : true;
      const s = summaries[a.id];
      const scheduledPass = !minScheduledCutoff || (s?.scheduledCount ?? 0) >= minScheduledCutoff;
      return matchesQuery && inPins && scheduledPass;
    });

    arr = arr.slice().sort((a, b) => {
      const sa = summaries[a.id];
      const sb = summaries[b.id];
      if (sortKey === "name") return displayName(a).localeCompare(displayName(b));
      if (sortKey === "lastCompleted") {
        const la = sa?.lastCompleted ?? "";
        const lb = sb?.lastCompleted ?? "";
        return (lb || "").localeCompare(la || "");
      }
      // compliance
      const pa = sa && sa.scheduledCount > 0 ? Math.round((100 * sa.completedCount) / sa.scheduledCount) : -1;
      const pb = sb && sb.scheduledCount > 0 ? Math.round((100 * sb.completedCount) / sb.scheduledCount) : -1;
      return pb - pa;
    });

    return arr;
  }, [athletes, summaries, search, onlyPinned, pinned, sortKey, minScheduledCutoff]);

  /* ---------------------------- Select helpers --------------------------- */
  const toggleSelected = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAll = () => setSelected(filtered.map((a) => a.id));
  const clearSelected = () => setSelected([]);

  /* ------------------------------ Renderers ------------------------------ */
  const thisWeekRangeTag = (
    <span className="text-xs sm:text-sm" style={{ color: "var(--muted)" }}>
      {new Date(weekStart).toLocaleDateString()} – {new Date(addDaysISO(weekStart, 6)).toLocaleDateString()}
    </span>
  );

  return (
    <div className="max-w-7xl mx-auto pb-16">
      <NavBar />

      {/* Header / Hero */}
      <div className="mt-4 rounded-2xl p-5 md:p-6" style={{ background: "linear-gradient(140deg,#0b0f19,#171a23)" }}>
        <div className="flex items-start gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Coach Dashboard</h1>
            <p className="text-sm md:text-base mt-1" style={{ color: "var(--muted)" }}>
              Command center for athlete oversight and weekly programming.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <InlineWeekPicker value={weekStart} onChange={(v) => setWeekStart(v)} />
            <button
              type="button"
              className="btn"
              onClick={() => setAutoRefresh(v => !v)}
              title={autoRefresh ? "Realtime on" : "Realtime off"}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? "animate-spin-slow" : ""}`} />
              {autoRefresh ? "Realtime" : "Manual"}
            </button>
            <button type="button" className="btn" onClick={exportCSV}>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </button>
          </div>
        </div>

        {/* Quick KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4 mt-4">
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  Athletes
                </div>
                <div className="text-xl font-semibold">{athletes.length}</div>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  Active This Week
                </div>
                <div className="text-xl font-semibold">{totals.activeAthletes}</div>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  Weekly Compliance
                </div>
                <div className="text-xl font-semibold">{totals.compliance}%</div>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  Sessions This Week
                </div>
                <div className="text-xl font-semibold">{totals.scheduled}</div>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  Minutes Done / Planned
                </div>
                <div className="text-xl font-semibold">
                  {totals.minComp} / {totals.minSched}
                </div>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-white/10">
                <AlertCircle className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  At-Risk (zero done)
                </div>
                <div className="text-xl font-semibold">{Array.from(riskFlags).length}</div>
              </div>
            </div>
          </div>
        </div>

        {(guardText || note) && (
          <div className="mt-3 text-xs">
            {guardText ? <div style={{ color: "#fca5a5" }}>{guardText}</div> : null}
            {note ? <div style={{ color: "#fca5a5" }}>{note}</div> : null}
          </div>
        )}
      </div>

      {/* Coach Actions / Filters */}
      <div className="mt-6 card p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold">Coach Controls</h3>
          <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
            {thisWeekRangeTag}
          </span>
        </div>

        <div className="mt-3 grid md:grid-cols-2 gap-3">
          {/* Left: Search + Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search athletes…"
                className="field w-full sm:w-64"
                aria-label="Search athletes"
              />
              <div className="relative inline-flex items-center">
                <Filter className="w-4 h-4 absolute left-2 opacity-60" />
                <select
                  className="field pl-8"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as any)}
                  aria-label="Sort athletes"
                >
                  <option value="compliance">Sort: Compliance</option>
                  <option value="name">Sort: Name</option>
                  <option value="lastCompleted">Sort: Last Completed</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs opacity-70">Min Scheduled</label>
                <input
                  type="number"
                  className="field w-20"
                  min={0}
                  value={minScheduledCutoff}
                  onChange={(e) => setMinScheduledCutoff(Number(e.target.value || 0))}
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-current"
                checked={onlyPinned}
                onChange={(e) => setOnlyPinned(e.target.checked)}
              />
              Show pinned only
            </label>

            {(loadingList || loadingStats) && (
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                Refreshing…
              </span>
            )}
          </div>

          {/* Right: Bulk Actions */}
          <div className="flex items-center justify-start md:justify-end gap-2 flex-wrap">
            <button className="btn" onClick={selectAll}>Select All</button>
            <button className="btn" onClick={clearSelected}>Clear</button>
            <button
              className="btn btn-dark"
              disabled={selected.length === 0}
              onClick={() => setComposerOpen(true)}
              title="Message selected"
            >
              <MessageSquarePlus className="w-4 h-4 mr-2" /> Message ({selected.length})
            </button>
            {selected.length === 1 ? (
              <Link
                className="btn"
                href={`/coach-console/${selected[0]}?week=${weekStart}`}
                title="Open selected athlete's console"
              >
                Open Console <ArrowUpRight className="w-4 h-4 ml-1" />
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {/* Inbox */}
      <div className="mt-6 card p-4">
        <button className="w-full text-left flex items-center gap-2" onClick={() => setInboxOpen((v) => !v)} aria-expanded={inboxOpen}>
          {inboxOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="font-semibold">Coach Inbox</span>
          {unreadCount > 0 && (
            <span
              className="ml-2 inline-flex items-center justify-center text-xs rounded-full px-2 py-0.5"
              style={{ background: "rgba(16,185,129,0.15)", color: "rgb(16,185,129)" }}
            >
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
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                No messages yet.
              </div>
            ) : (
              recentMessages.map((m) => (
                <div key={m.id} className="rounded bg-white/5 p-2 flex items-start gap-2">
                  <div className="flex-1">
                    <div className="text-xs opacity-80 flex items-center gap-2">
                      <span>{new Date(m.created_at).toLocaleString()}</span>
                      {m.read_at == null ? (
                        <span className="ml-1 text-xs" style={{ color: "rgb(16,185,129)" }}>
                          • new
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm mt-1 line-clamp-2">{m.body}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.read_at == null ? (
                      <button className="btn" onClick={() => markMessageRead(m.id)}>
                        Mark read
                      </button>
                    ) : null}
                    <Link href={`/coach-console/${m.athlete_id}?focusMessageId=${m.id}`} className="btn btn-dark" title="Open in athlete console">
                      Open
                    </Link>
                  </div>
                </div>
              ))
            )}
            <div className="pt-2">
              <Link href="/coach/inbox" className="btn">
                Go to Inbox
              </Link>
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
            <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>
              (lowest weekly compliance)
            </span>
          </div>
          <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lowComplianceAthletes.map((r) => {
              const who = athletes.find((a) => a.id === r.id);
              const name = who ? displayName(who) : r.id.slice(0, 8);
              const pct = r.pct;
              const barWidth = `${Math.min(100, Math.max(0, pct))}%`;
              const risk = riskFlags.has(r.id);
              return (
                <button key={r.id} className="card p-3 text-left hover:shadow-lg transition" onClick={() => openAthlete(r.id)}>
                  <div className="flex items-center gap-2">
                    <div className="font-medium truncate">{name}</div>
                    <span className="ml-auto text-sm">{pct}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full rounded bg-white/10">
                    <div className="h-2 rounded" style={{ width: barWidth, background: risk ? "#ef4444" : "var(--pine,#10b981)" }} />
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

        {athletes.length === 0 ? (
          <div className="text-sm mt-4" style={{ color: "var(--muted)" }}>
            You have no linked athletes yet.
          </div>
        ) : (
          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((a) => {
              const s = summaries[a.id];
              const pct = s && s.scheduledCount > 0 ? Math.round((100 * s.completedCount) / s.scheduledCount) : 0;
              const barWidth = `${Math.min(100, Math.max(0, pct))}%`;
              const selectedState = selected.includes(a.id);
              const risk = riskFlags.has(a.id);
              return (
                <div key={a.id} className={`card p-4 hover:shadow-lg transition ${selectedState ? "ring-2 ring-blue-400" : ""}`}>
                  <div className="flex items-center gap-3">
                    <button
                      className="btn"
                      onClick={() => toggleSelected(a.id)}
                      aria-pressed={selectedState}
                      title={selectedState ? "Deselect" : "Select"}
                    >
                      {selectedState ? "✓" : "+"}
                    </button>
                    <div
                      className="flex items-center justify-center"
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: "linear-gradient(180deg,#1f2937,#111827)",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 18,
                      }}
                    >
                      {(displayName(a)[0] || "?").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium flex items-center gap-2">
                        {displayName(a)}
                        <button
                          className="btn"
                          onClick={() => togglePin(a.id)}
                          title={isPinned(a.id) ? "Unpin" : "Pin"}
                        >
                          {isPinned(a.id) ? <Star className="w-4 h-4" /> : <StarOff className="w-4 h-4" />}
                        </button>
                      </div>
                      <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
                        {a.email ?? "No email"}
                      </div>
                    </div>
                    <div className="ml-auto text-sm flex items-center gap-2">
                      {risk ? (
                        <span className="inline-flex items-center text-xs px-2 py-0.5 rounded" style={{ background: "#f59e0b22", color: "#f59e0b" }}>
                          <Clock className="w-3 h-3 mr-1" /> At risk
                        </span>
                      ) : null}
                      <span>{pct}%</span>
                    </div>
                  </div>

                  <div className="mt-3 h-2 w-full rounded bg-white/10">
                    <div className="h-2 rounded" style={{ width: barWidth, background: risk ? "#ef4444" : "var(--pine, #10b981)" }} />
                  </div>

                  <div className="mt-2 text-xs flex items-center gap-2 flex-wrap" style={{ color: "var(--muted)" }}>
                    <span>
                      This week: <strong>{s?.scheduledCount ?? 0}</strong> planned • <strong>{s?.completedCount ?? 0}</strong> done •
                      <strong> {s?.minutesCompleted ?? 0}</strong>/<strong>{s?.minutesScheduled ?? 0}</strong> min
                    </span>
                    {s?.lastCompleted ? <span>• Last: {new Date(s.lastCompleted).toLocaleDateString()}</span> : null}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button className="btn btn-dark" onClick={() => openAthlete(a.id)}>
                      Open Console <ArrowUpRight className="w-4 h-4 ml-1" />
                    </button>
                    <button className="btn" onClick={() => { setSelected([a.id]); setComposerOpen(true); }}>
                      <Mail className="w-4 h-4 mr-2" /> Message
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Composer Modal (lightweight, no portal) */}
      {composerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          role="dialog"
          aria-modal="true"
        >
          <div className="card p-4 w-full max-w-lg">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4" />
              <h4 className="font-semibold">Message selected athletes ({selected.length})</h4>
            </div>
            <textarea
              className="field h-40"
              placeholder="Type your announcement, coaching cue, or reminder…"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
            />
            <div className="mt-3 flex items-center gap-2 justify-end">
              <button className="btn" onClick={() => setComposerOpen(false)} disabled={sending}>
                Cancel
              </button>
              <button className="btn btn-dark" onClick={sendMessage} disabled={sending || !messageText.trim()}>
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Styles -------------------------------- */
// Optional: slow spin for realtime icon (utility if not present in your CSS)
// Add this to your global CSS if you don't already have something similar:
// .animate-spin-slow { animation: spin 3s linear infinite; }
