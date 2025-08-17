"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { getSupabase } from "@/lib/supabaseClient";
import { Inbox, Pin, PinOff, Search, Filter, CheckCheck, ChevronRight } from "lucide-react";

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
};

type MessageRow = {
  id: string;
  coach_id: string;
  athlete_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

type Thread = {
  athlete_id: string;
  athlete: Profile | null;
  last_message: MessageRow | null;
  unread: number;
  last_when: string; // iso
};

const PINS_KEY = "coach_inbox_pins_v1";

export default function CoachInboxPage() {
  const supabase = useMemo(() => getSupabase(), []);
  const [meId, setMeId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  // UI state
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [pinned, setPinned] = useState<string[]>([]);
  const chRef = useRef<any>(null);

  // load pins from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      if (raw) setPinned(JSON.parse(raw));
    } catch {/* ignore */}
  }, []);
  function savePins(next: string[]) {
    setPinned(next);
    try { localStorage.setItem(PINS_KEY, JSON.stringify(next)); } catch {}
  }
  function togglePin(athleteId: string) {
    const next = pinned.includes(athleteId)
      ? pinned.filter(id => id !== athleteId)
      : [...pinned, athleteId];
    savePins(next);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setNote("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setNote("Please sign in."); setLoading(false); return; }
      setMeId(user.id);

      // Fetch recent messages in bulk to assemble threads client-side.
      // (If you expect huge volume, switch to a SQL view that returns one row per thread.)
      const msgs = await supabase
        .from("messages")
        .select("*")
        .eq("coach_id", user.id)
        .order("created_at", { ascending: false })
        .limit(600);
      if (msgs.error) throw msgs.error;
      const list = (msgs.data ?? []) as MessageRow[];

      // Build threads
      const byAthlete = new Map<string, Thread>();
      for (const m of list) {
        let t = byAthlete.get(m.athlete_id);
        if (!t) {
          t = { athlete_id: m.athlete_id, athlete: null, last_message: m, unread: 0, last_when: m.created_at };
          byAthlete.set(m.athlete_id, t);
        }
        // count unread if I am recipient
        if (m.recipient_id === user.id && !m.read_at) t.unread += 1;
      }

      // Resolve athlete profiles
      const ids = Array.from(byAthlete.keys());
      let profiles: Profile[] = [];
      if (ids.length) {
        const profs = await supabase.from("profiles").select("id,email,display_name").in("id", ids);
        if (!profs.error) profiles = (profs.data ?? []) as Profile[];
      }
      const pMap = new Map(profiles.map(p => [p.id, p]));

      const rows = Array.from(byAthlete.values())
        .map(t => ({ ...t, athlete: pMap.get(t.athlete_id) || null }))
        .sort((a, b) => b.last_when.localeCompare(a.last_when));

      setThreads(rows);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // Realtime: reload on any message involving me
  useEffect(() => {
    if (!meId) return;

    try {
      const old = chRef.current;
      if (old) {
        if (typeof (supabase as any).removeChannel === "function") {
          (supabase as any).removeChannel(old);
        } else if (typeof old.unsubscribe === "function") {
          old.unsubscribe();
        }
        chRef.current = null;
      }
    } catch {}

    const ch = supabase
      .channel(`coach-inbox-${meId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `coach_id=eq.${meId}` },
        () => load()
      )
      .subscribe();

    chRef.current = ch;
    return () => {
      try {
        const cur = chRef.current;
        if (!cur) return;
        if (typeof (supabase as any).removeChannel === "function") {
          (supabase as any).removeChannel(cur);
        } else if (typeof cur.unsubscribe === "function") {
          cur.unsubscribe();
        }
        chRef.current = null;
      } catch {}
    };
  }, [supabase, meId, load]);

  function fmtWhen(ts?: string | null) {
    if (!ts) return "";
    try { return new Date(ts).toLocaleString(); } catch { return ts; }
  }

  // Mark all unread msgs in a thread as read
  const markThreadRead = useCallback(async (athleteId: string) => {
    if (!meId) return;
    try {
      await supabase
        .from("messages")
        .update({ read_at: new Date().toISOString() })
        .eq("coach_id", meId)
        .eq("athlete_id", athleteId)
        .eq("recipient_id", meId)
        .is("read_at", null);
      // Optimistic UI: update local state
      setThreads(prev => prev.map(t => t.athlete_id === athleteId ? { ...t, unread: 0 } : t));
    } catch {/* ignore */}
  }, [supabase, meId]);

  const normalizedQuery = query.trim().toLowerCase();
  const filterMatch = (t: Thread) => {
    if (unreadOnly && t.unread === 0) return false;
    if (!normalizedQuery) return true;
    const name = (t.athlete?.display_name || t.athlete?.email || "").toLowerCase();
    const last = (t.last_message?.body || "").toLowerCase();
    return name.includes(normalizedQuery) || last.includes(normalizedQuery);
  };

  const pinnedThreads = threads.filter(t => pinned.includes(t.athlete_id)).filter(filterMatch);
  const otherThreads = threads.filter(t => !pinned.includes(t.athlete_id)).filter(filterMatch);

  return (
    <div className="max-w-7xl mx-auto pb-14">
      <NavBar />

      {/* Header */}
      <div className="mt-6 card p-4 flex items-center gap-3">
        <Inbox className="text-emerald-300" />
        <div>
          <p className="text-xs text-slate-400">Coach</p>
          <h1 className="text-xl font-semibold">Inbox</h1>
        </div>
        <div className="ml-auto text-sm" style={{ color: "var(--muted)" }}>
          {loading ? "Loading…" : note || ""}
        </div>
      </div>

      {/* Controls */}
      <div className="mt-4 card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
            <input
              className="w-full pl-8 pr-3 py-2 rounded bg-white/5 border border-white/10"
              placeholder="Search by athlete or message…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            className={`btn ${unreadOnly ? "btn-dark" : ""} inline-flex items-center gap-2`}
            onClick={() => setUnreadOnly(v => !v)}
            title="Toggle unread only"
          >
            <Filter className="w-4 h-4" />
            {unreadOnly ? "Unread only" : "All"}
          </button>
        </div>
      </div>

      {/* Pinned */}
      {pinnedThreads.length > 0 && (
        <div className="mt-4 card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Pin className="w-4 h-4 text-emerald-300" />
            <h3 className="font-semibold">Pinned</h3>
          </div>
          <ThreadList
            items={pinnedThreads}
            onTogglePin={togglePin}
            onMarkRead={markThreadRead}
          />
        </div>
      )}

      {/* All Threads */}
      <div className="mt-4 card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Inbox className="w-4 h-4 text-emerald-300" />
          <h3 className="font-semibold">All conversations</h3>
          <span className="text-sm ml-auto" style={{ color: "var(--muted)" }}>
            {pinnedThreads.length + otherThreads.length} total
          </span>
        </div>

        {(pinnedThreads.length + otherThreads.length) === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {loading ? "Loading…" : "No conversations match your filters."}
          </div>
        ) : (
          <ThreadList
            items={otherThreads}
            onTogglePin={togglePin}
            onMarkRead={markThreadRead}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------- Components ---------------- */

function ThreadList({
  items,
  onTogglePin,
  onMarkRead,
}: {
  items: Thread[];
  onTogglePin: (athleteId: string) => void;
  onMarkRead: (athleteId: string) => void;
}) {
  return (
    <div className="divide-y divide-white/10">
      {items.map((t) => {
        const name = t.athlete?.display_name || t.athlete?.email || "Athlete";
        const initial = (name || "?").slice(0, 1).toUpperCase();
        const last = t.last_message?.body ?? "";
        const when = fmtWhen(t.last_message?.created_at);
        return (
          <div key={t.athlete_id} className="py-2">
            <div className="flex items-center gap-3">
              <div className="avatar">{initial}</div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    className="font-medium truncate hover:underline"
                    href={`/coach-console/${t.athlete_id}?tab=messages`}
                    title="Open thread"
                  >
                    {name}
                  </Link>
                  {t.unread > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-600 text-black">
                      {t.unread} new
                    </span>
                  )}
                  <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>{when}</div>
                </div>
                <div className="text-sm truncate" style={{ color: "var(--muted)" }}>
                  {last || "Start the conversation →"}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  className="btn"
                  onClick={() => onMarkRead(t.athlete_id)}
                  title="Mark all as read"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
                <button
                  className="btn"
                  onClick={() => onTogglePin(t.athlete_id)}
                  title="Pin/unpin"
                >
                  {/** Simple visual toggle; you could pass pinned state separately if desired */}
                  <Pin className="w-4 h-4" />
                </button>
                <Link
                  className="btn btn-dark inline-flex items-center gap-1"
                  href={`/coach-console/${t.athlete_id}?tab=messages`}
                  title="Open thread"
                >
                  Open <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function fmtWhen(ts?: string | null) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString(); } catch { return ts || ""; }
}
