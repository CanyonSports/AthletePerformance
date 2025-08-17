"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Supa from "@/lib/supabaseClient";
import { Users, Mail, CalendarDays, ChevronDown, ChevronRight, LayoutTemplate } from "lucide-react";

/* ---------------- Types ---------------- */
type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "athlete" | "coach" | "admin" | null;
};

type CoachLink = { coach_id: string; athlete_id: string; created_at: string };

type AthleteLite = { id: string; display_name: string | null; email: string | null };

type MessageRow = {
  id: string;
  athlete_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeekISO(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Monday=0
  x.setDate(x.getDate() - dow);
  return ymd(x);
}
function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, 12);
  dt.setDate(dt.getDate() + days);
  return ymd(dt);
}

/* ---------------- Page ---------------- */
export default function CoachDashboardPage() {
  // Supabase (support getSupabase() or exported client)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const router = useRouter();

  const [me, setMe] = useState<Profile | null>(null);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");

  const [athletes, setAthletes] = useState<AthleteLite[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [recentMessages, setRecentMessages] = useState<MessageRow[]>([]);
  const [sessionsThisWeek, setSessionsThisWeek] = useState<number>(0);

  const [inboxOpen, setInboxOpen] = useState(false);

  const thisWeekStart = useMemo(() => startOfWeekISO(), []);

  /* -------------- Load profile & gate to coach -------------- */
  const loadMe = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    setNote("");
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) { router.push("/login"); return; }

      const res = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (res.error) throw res.error;
      const profile = res.data as Profile;
      setMe(profile);

      // If not a coach/admin, send them back to athlete dashboard
      if (profile.role !== "coach" && profile.role !== "admin") {
        router.push("/dashboard");
      }
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase, router]);

  useEffect(() => { loadMe(); }, [loadMe]);

  /* -------------- Load athletes (linked) -------------- */
  const loadAthletes = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const links = await supabase
        .from("coach_athletes")
        .select("athlete_id")
        .eq("coach_id", user.id);
      if (links.error) throw links.error;

      const ids = (links.data ?? []).map((r: any) => r.athlete_id);
      if (ids.length === 0) { setAthletes([]); return; }

      const profs = await supabase
        .from("profiles")
        .select("id,display_name,email")
        .in("id", ids);
      if (profs.error) throw profs.error;

      const list = (profs.data ?? []) as AthleteLite[];
      list.sort((a, b) => (a.display_name || a.email || "").localeCompare(b.display_name || b.email || ""));
      setAthletes(list);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase]);

  /* -------------- Load KPIs -------------- */
  const loadKPIs = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Unread messages aimed at this coach
      const unread = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", user.id)
        .is("read_at", null);
      if (unread.error) throw unread.error;
      setUnreadCount(unread.count ?? 0);

      // Sessions scheduled for linked athletes this week
      const links = await supabase
        .from("coach_athletes")
        .select("athlete_id")
        .eq("coach_id", user.id);
      if (links.error) throw links.error;

      const ids = (links.data ?? []).map((r: any) => r.athlete_id);
      if (ids.length === 0) { setSessionsThisWeek(0); return; }

      const weekEnd = addDaysISO(thisWeekStart, 7);
      const sesh = await supabase
        .from("training_plan_items")
        .select("id", { head: true, count: "exact" })
        .in("user_id", ids)
        .gte("session_date", thisWeekStart)
        .lt("session_date", weekEnd);
      if (sesh.error) throw sesh.error;
      setSessionsThisWeek(sesh.count ?? 0);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase, thisWeekStart]);

  /* -------------- Load recent messages (collapsible inbox) -------------- */
  const loadRecentMessages = useCallback(async () => {
    if (!isConfigured || !supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const res = await supabase
        .from("messages")
        .select("*")
        .eq("recipient_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (res.error) throw res.error;

      setRecentMessages((res.data ?? []) as MessageRow[]);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    }
  }, [isConfigured, supabase]);

  useEffect(() => { loadAthletes(); loadKPIs(); loadRecentMessages(); }, [loadAthletes, loadKPIs, loadRecentMessages]);

  /* -------------- Realtime: messages + links -------------- */
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
          () => { if (mounted) { loadKPIs(); loadRecentMessages(); } }
        )
        .on("postgres_changes",
          { event: "*", schema: "public", table: "coach_athletes", filter: `coach_id=eq.${user.id}` },
          () => { if (mounted) { loadAthletes(); loadKPIs(); } }
        )
        .subscribe();

      // cleanup
      return () => {
        try { supabase.removeChannel(ch); } catch {}
      };
    })();

    return () => { mounted = false; };
  }, [isConfigured, supabase, loadAthletes, loadKPIs, loadRecentMessages]);

  /* ---------------- UI helpers ---------------- */
  const athletesCount = athletes.length;

  function displayName(a: AthleteLite) {
    return a.display_name || a.email || a.id.slice(0, 8);
  }

  /* ---------------- Render ---------------- */
  return (
    <div className="max-w-7xl mx-auto pb-16">
      {/* Sticky header */}
      <div
        className="card p-4"
        style={{ position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(6px)", background: "rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <h1 className="text-xl font-semibold">Coach Dashboard</h1>
          <div className="ml-auto flex items-center gap-2">
            {/* NEW: Templates button */}
            <Link href="/coach/templates" className="btn" title="Open Template Library">
              <LayoutTemplate className="w-4 h-4 mr-1" />
              Templates
            </Link>
          </div>
        </div>
        {note ? <div className="text-xs mt-2" style={{ color: "#fca5a5" }}>{note}</div> : null}
      </div>

      {/* KPI cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full p-2 bg-white/10"><Users className="w-5 h-5 text-emerald-300" /></div>
            <div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>Athletes</div>
              <div className="text-2xl font-semibold">{athletesCount}</div>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full p-2 bg-white/10"><Mail className="w-5 h-5 text-emerald-300" /></div>
            <div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>Unread Messages</div>
              <div className="text-2xl font-semibold">{unreadCount}</div>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full p-2 bg-white/10"><CalendarDays className="w-5 h-5 text-emerald-300" /></div>
            <div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>Sessions This Week</div>
              <div className="text-2xl font-semibold">{sessionsThisWeek}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible Inbox */}
      <div className="mt-6 card p-4">
        <button
          className="w-full text-left flex items-center gap-2"
          onClick={() => setInboxOpen((v) => !v)}
          aria-expanded={inboxOpen}
        >
          {inboxOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="font-semibold">Inbox</span>
          {unreadCount > 0 ? (
            <span className="ml-2 inline-flex items-center justify-center text-xs rounded-full px-2 py-0.5"
                  style={{ background: "rgba(16,185,129,0.15)", color: "rgb(16,185,129)" }}>
              {unreadCount} new
            </span>
          ) : null}
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
                  <div className="text-sm">
                    <span className="opacity-80">{new Date(m.created_at).toLocaleString()}</span>
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

      {/* Athletes list */}
      <div className="mt-6 card p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Your Athletes</h3>
          <span className="text-sm ml-auto" style={{ color: "var(--muted)" }}>
            Week of {new Date(thisWeekStart).toLocaleDateString()}
          </span>
        </div>

        {athletes.length === 0 ? (
          <div className="text-sm mt-2" style={{ color: "var(--muted)" }}>
            You have no linked athletes yet.
          </div>
        ) : (
          <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {athletes.map((a) => (
              <div key={a.id} className="card p-3">
                <div className="flex items-center gap-2">
                  <div className="avatar">{(displayName(a) || "?").slice(0, 1).toUpperCase()}</div>
                  <div className="flex-1">
                    <div className="font-medium">{displayName(a)}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>{a.email}</div>
                  </div>
                  <Link href={`/coach-console/${a.id}`} className="btn">Open Console</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
