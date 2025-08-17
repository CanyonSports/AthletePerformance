// components/CoachInboxBell.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabaseClient";
import { Bell, X, UserCircle, ArrowUpRight } from "lucide-react";

type Profile = { id: string; email: string | null; display_name: string | null };
type Msg = {
  id: string;
  coach_id: string;
  athlete_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export default function CoachInboxBell() {
  const supabase = useMemo(() => getSupabase(), []);
  const [meId, setMeId] = useState<string | null>(null);
  const [unread, setUnread] = useState<(Msg & { athlete?: Profile })[]>([]);
  const [open, setOpen] = useState(false);
  const channelRef = useRef<any>(null);

  const loadUnread = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setMeId(null); setUnread([]); return; }
      setMeId(user.id);

      // Unread messages sent to me (coach)
      const { data: msgs, error } = await supabase
        .from("messages")
        .select("*")
        .eq("recipient_id", user.id)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      const list = (msgs ?? []) as Msg[];
      if (list.length === 0) { setUnread([]); return; }

      // Attach athlete profiles to show names in the drawer
      const athleteIds = Array.from(new Set(list.map(m => m.athlete_id)));
      const { data: ppl, error: perr } = await supabase
        .from("profiles")
        .select("id,email,display_name")
        .in("id", athleteIds);
      if (perr) throw perr;
      const map = new Map((ppl ?? []).map(p => [p.id, p as Profile]));

      setUnread(list.map(m => ({ ...m, athlete: map.get(m.athlete_id) })));
    } catch {
      /* ignore; keep prior state */
    }
  }, [supabase]);

  // Initial + realtime
  useEffect(() => { loadUnread(); }, [loadUnread]);

  useEffect(() => {
    let cancelled = false;

    // clean old channel (strict mode safety)
    try {
      const old = channelRef.current;
      if (old) {
        if (typeof (supabase as any).removeChannel === "function") {
          (supabase as any).removeChannel(old);
        } else if (typeof old.unsubscribe === "function") {
          old.unsubscribe();
        }
        channelRef.current = null;
      }
    } catch {}

    if (!meId) return;

    const ch = supabase
      .channel(`coach-inbox-bell:${meId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `recipient_id=eq.${meId}` },
        () => { if (!cancelled) loadUnread(); }
      )
      .subscribe();

    channelRef.current = ch;
    return () => {
      cancelled = true;
      try {
        const cur = channelRef.current;
        if (!cur) return;
        if (typeof (supabase as any).removeChannel === "function") {
          (supabase as any).removeChannel(cur);
        } else if (typeof (cur as any).unsubscribe === "function") {
          (cur as any).unsubscribe();
        }
        channelRef.current = null;
      } catch {}
    };
  }, [supabase, meId, loadUnread]);

  // Nothing to show if no unread
  if (!unread.length) return null;

  // Small floating bell + drawer
  return (
    <>
      {/* Floating bell */}
      <button
        className="fixed right-5 bottom-5 z-40 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-600 text-black shadow-lg hover:bg-emerald-500"
        onClick={() => setOpen(true)}
        aria-label="Open coach inbox"
        title="New messages"
      >
        <Bell className="w-5 h-5" />
        <span className="font-semibold text-sm">Inbox</span>
        <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-black/20">{unread.length}</span>
      </button>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-50">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          {/* panel */}
          <div className="absolute right-4 bottom-16 sm:bottom-20 w-[92vw] max-w-md rounded-xl border border-white/10 bg-neutral-900 shadow-2xl">
            <div className="p-3 flex items-center gap-2 border-b border-white/10">
              <Bell className="text-emerald-300" />
              <div className="font-semibold">New Messages</div>
              <div className="ml-auto">
                <button className="btn btn-dark px-2 py-1" onClick={() => setOpen(false)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/10">
              {unread.map(m => {
                const name = m.athlete?.display_name || m.athlete?.email || "Athlete";
                const when = new Date(m.created_at).toLocaleString();
                return (
                  <Link
                    key={m.id}
                    href={`/coach-console/${m.athlete_id}?tab=messages&focus=${m.id}`}
                    className="block p-3 hover:bg-white/5"
                    onClick={() => setOpen(false)}
                  >
                    <div className="flex items-start gap-2">
                      <UserCircle className="w-6 h-6 text-emerald-300 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate">{name}</div>
                          <span className="text-[10px]" style={{ color: "var(--muted)" }}>{when}</span>
                          <ArrowUpRight className="w-4 h-4 ml-auto opacity-70" />
                        </div>
                        <div className="text-sm mt-0.5 line-clamp-2 opacity-90">{m.body}</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="p-2 text-xs text-center" style={{ color: "var(--muted)" }}>
              Opening an athlete console marks unread messages as read.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
