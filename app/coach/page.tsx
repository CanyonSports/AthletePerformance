// app/coach/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { getSupabase } from "@/lib/supabaseClient";
import CoachInboxBell from "@/components/CoachInboxBell";
import {
  Users,
  CalendarRange,
  CheckCircle2,
  Percent,
  Inbox,
  UserCircle2,
} from "lucide-react";

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "athlete" | "coach" | "admin" | null;
};

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return ymd(dt);
}
function startOfWeekISO(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Monday=0
  x.setDate(x.getDate() - day);
  return ymd(x);
}

export default function CoachDashboardPage() {
  const supabase = useMemo(() => getSupabase(), []);
  const [me, setMe] = useState<Profile | null>(null);
  const [athletes, setAthletes] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  // KPI state
  const [athleteCount, setAthleteCount] = useState(0);
  const [weekScheduled, setWeekScheduled] = useState(0);
  const [weekCompleted, setWeekCompleted] = useState(0);
  const [adherencePct, setAdherencePct] = useState<number>(0);
  const [unreadCount, setUnreadCount] = useState(0);

  const msgChannelRef = useRef<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNote("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setNote("Please sign in."); setLoading(false); return; }

      // me
      const meRes = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (meRes.error) throw meRes.error;
      const meProfile = meRes.data as Profile;
      setMe(meProfile);

      if (meProfile.role !== "coach" && meProfile.role !== "admin") {
        setNote("You must be a coach to view this page.");
        setAthletes([]);
        setAthleteCount(0);
        setWeekScheduled(0);
        setWeekCompleted(0);
        setAdherencePct(0);
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      // linked athletes
      const links = await supabase.from("coach_athletes").select("athlete_id").eq("coach_id", user.id);
      if (links.error) throw links.error;
      const ids: string[] = (links.data ?? []).map((r: any) => r.athlete_id);
      setAthleteCount(ids.length);

      if (ids.length > 0) {
        const ppl = await supabase.from("profiles").select("id,email,display_name").in("id", ids);
        if (ppl.error) throw ppl.error;
        setAthletes((ppl.data ?? []) as Profile[]);
      } else {
        setAthletes([]);
      }

      // KPIs
      const today = ymd(new Date());
      const next7 = addDaysISO(today, 7);
      const weekStart = startOfWeekISO(new Date());
      const weekEnd = addDaysISO(weekStart, 7);

      // scheduled this week (all statuses)
      let scheduledCount = 0;
      let completedCount = 0;

      if (ids.length > 0) {
        const scheduled = await supabase
          .from("training_plan_items")
          .select("id", { count: "exact", head: true })
          .in("user_id", ids)
          .gte("session_date", weekStart)
          .lt("session_date", weekEnd);
        if (!scheduled.error) scheduledCount = scheduled.count ?? 0;

        const completed = await supabase
          .from("training_plan_items")
          .select("id", { count: "exact", head: true })
          .in("user_id", ids)
          .eq("status", "completed")
          .gte("session_date", weekStart)
          .lt("session_date", weekEnd);
        if (!completed.error) completedCount = completed.count ?? 0;
      }

      setWeekScheduled(scheduledCount);
      setWeekCompleted(completedCount);
      setAdherencePct(scheduledCount > 0 ? Math.round((completedCount / scheduledCount) * 100) : 0);

      // unread messages for coach
      const unread = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", meProfile.id)
        .is("read_at", null);
      setUnreadCount(unread.error ? 0 : (unread.count ?? 0));
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // Realtime: update unread count when new messages arrive / change
  useEffect(() => {
    if (!me) return;

    // clear previous
    try {
      const old = msgChannelRef.current;
      if (old) {
        if (typeof (supabase as any).removeChannel === "function") {
          (supabase as any).removeChannel(old);
        } else if (typeof old.unsubscribe === "function") {
          old.unsubscribe();
        }
        msgChannelRef.current = null;
      }
    } catch {}

    const ch = supabase
      .channel(`coach-inbox-${me.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `recipient_id=eq.${me.id}` },
        async () => {
          const unread = await supabase
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("recipient_id", me.id)
            .is("read_at", null);
          setUnreadCount(unread.error ? 0 : (unread.count ?? 0));
        }
      )
      .subscribe();

    msgChannelRef.current = ch;
    return () => {
      try {
        const cur = msgChannelRef.current;
        if (!cur) return;
        if (typeof (supabase as any).removeChannel === "function") {
          (supabase as any).removeChannel(cur);
        } else if (typeof cur.unsubscribe === "function") {
          cur.unsubscribe();
        }
        msgChannelRef.current = null;
      } catch {}
    };
  }, [supabase, me]);

  return (
    <div className="max-w-7xl mx-auto pb-14">
      <NavBar />

      {/* Header */}
      <div className="mt-6 card p-4 flex items-center gap-3">
        <Users className="text-emerald-300" />
        <div>
          <p className="text-xs text-slate-400">Coach</p>
          <h1 className="text-xl font-semibold">Dashboard</h1>
        </div>
        <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>
          {loading ? "Loading…" : ""}
          {note && !loading ? note : ""}
        </div>
      </div>

      {/* KPI Grid */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard
          icon={<Users className="w-5 h-5" />}
          label="Athletes"
          value={athleteCount}
          sub="Linked to you"
        />
        <KpiCard
          icon={<CalendarRange className="w-5 h-5" />}
          label="This Week — Scheduled"
          value={weekScheduled}
          sub="All statuses"
        />
        <KpiCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="This Week — Completed"
          value={weekCompleted}
          sub="Marked completed"
        />
        <KpiCard
          icon={<Percent className="w-5 h-5" />}
          label="Adherence"
          value={`${adherencePct}%`}
          sub="Completed / Scheduled"
        />
        <KpiCard
          icon={<Inbox className="w-5 h-5" />}
          label="Unread"
          value={unreadCount}
          sub="Messages"
          highlight={unreadCount > 0}
        />
      </div>

      {/* Quick Inbox (compact) */}
      <div className="mt-6 card p-4 flex items-center gap-3">
        <Inbox className="text-emerald-300" />
        <div className="min-w-0">
          <div className="font-semibold">Inbox</div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {unreadCount === 0 ? "You’re all caught up." : `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}.`}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link className="btn btn-dark" href="/coach/inbox">Open Inbox</Link>
        </div>
      </div>

      {/* Athletes grid — no message previews here */}
      <div className="mt-6 card p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Your Athletes</h3>
          <span className="text-sm ml-auto" style={{ color: "var(--muted)" }}>
            {athletes.length} linked
          </span>
        </div>

        {loading ? (
          <div className="mt-3 text-sm" style={{ color: "var(--muted)" }}>Loading athletes…</div>
        ) : athletes.length === 0 ? (
          <div className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            No athletes linked yet. Share an invite or link from an athlete’s profile.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {athletes.map((a) => {
              const name = a.display_name || a.email || "Athlete";
              const initial = (name || "?").slice(0, 1).toUpperCase();
              return (
                <div key={a.id} className="card p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="avatar">{initial}</div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{name}</div>
                      <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
                        {a.email || "—"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-1 flex items-center gap-2">
                    <Link className="btn btn-dark w-full" href={`/coach-console/${a.id}`}>
                      Open Console
                    </Link>
                  </div>

                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    <div className="inline-flex items-center gap-1">
                      <UserCircle2 className="w-3 h-3" />
                      {a.id.slice(0, 8)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Collapsed inbox bell (only appears when there are unread messages) */}
      <CoachInboxBell />
    </div>
  );
}

/* --- Simple KPI card component (inline to avoid extra file) --- */
function KpiCard({
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`card p-4 ${highlight ? "ring-1 ring-emerald-400/60" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="text-slate-300">{icon}</div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>{sub || " "}</div>
      </div>
      <div className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
