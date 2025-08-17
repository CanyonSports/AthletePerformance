"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Supa from "@/lib/supabaseClient";
import { Bell, BellDot, CheckCheck, MessageSquare } from "lucide-react";

type Profile = { id: string; role: "athlete" | "coach" | "admin" | null };
type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  payload: any;
  read_at: string | null;
  created_at: string;
};

function useSupabase() {
  return useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
}

function timeAgo(ts: string) {
  const d = new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function NotificationsBell() {
  const supabase = useSupabase();
  const router = useRouter();

  const [me, setMe] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const channelRef = useRef<any>(null);

  async function loadMe() {
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMe(null); return; }
    const res = await supabase.from("profiles").select("id, role").eq("id", user.id).single();
    if (!res.error) setMe(res.data as Profile);
  }

  async function fetchNotifications() {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const rows = (data || []) as NotificationRow[];
      setItems(rows);
      setUnread(rows.filter(r => r.read_at == null).length);
    } finally {
      setLoading(false);
    }
  }

  async function markAllRead() {
    if (!supabase) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    await fetchNotifications();
  }

  useEffect(() => {
    loadMe().then(fetchNotifications);

    // realtime
    if (!supabase) return;
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const ch = supabase
        .channel(`notif-${user.id}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
          () => { if (mounted) fetchNotifications(); }
        )
        .subscribe();

      channelRef.current = ch;
    })();

    return () => {
      const ch = channelRef.current;
      try { if (supabase && ch) supabase.removeChannel(ch); ch?.unsubscribe?.(); } catch {}
    };
  }, [supabase]);

  function labelFor(n: NotificationRow) {
    if (n.kind === "message") {
      const from = n.payload?.sender_id === n.payload?.coach_id ? "Coach" : "Athlete";
      return `New message from ${from}`;
    }
    if (n.kind === "template_applied") {
      return "Template applied to your plan";
    }
    return n.kind;
  }

  function goTo(n: NotificationRow) {
    if (!me) return;
    // Deep-link rules
    if (n.kind === "message") {
      const athleteId = n.payload?.athlete_id;
      const messageId = n.payload?.message_id;
      if (me.role === "coach") {
        if (athleteId && messageId) router.push(`/coach-console/${athleteId}?focusMessageId=${messageId}`);
        else router.push(`/coach/inbox`);
      } else {
        // Athlete route (adjust if you have a dedicated inbox)
        router.push(`/training`);
      }
      return;
    }
    if (n.kind === "template_applied") {
      if (me.role === "coach") router.push(`/templates`);
      else router.push(`/training`);
      return;
    }
    // Fallback
    router.push("/notifications");
  }

  return (
    <div className="relative">
      <button
        className="relative px-2 py-1 rounded hover:bg-white/10 transition"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        {unread > 0 ? <BellDot className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 text-[10px] bg-emerald-500 text-black font-semibold rounded-full px-1.5 py-[1px]">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[320px] rounded border border-white/10 bg-black/90 backdrop-blur p-2 z-50 shadow-lg">
          <div className="flex items-center gap-2 px-1">
            <div className="text-sm font-semibold">Notifications</div>
            <div className="ml-auto flex items-center gap-2">
              <button
                className="text-xs underline opacity-80 hover:opacity-100"
                onClick={markAllRead}
                title="Mark all as read"
              >
                <span className="inline-flex items-center gap-1"><CheckCheck className="w-3.5 h-3.5" /> Mark all</span>
              </button>
            </div>
          </div>

          <div className="mt-2 max-h-[360px] overflow-auto space-y-1">
            {loading ? (
              <div className="text-sm opacity-70 px-2 py-4">Loading…</div>
            ) : items.length === 0 ? (
              <div className="text-sm opacity-70 px-2 py-4">You’re all caught up.</div>
            ) : items.map((n) => (
              <button
                key={n.id}
                onClick={() => { goTo(n); setOpen(false); }}
                className={`w-full text-left p-2 rounded hover:bg-white/5 transition ${n.read_at ? "opacity-80" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full p-1.5 bg-white/10">
                    <MessageSquare className="w-4 h-4 text-emerald-300" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{labelFor(n)}</div>
                    <div className="text-xs opacity-60">{timeAgo(n.created_at)} ago</div>
                  </div>
                  {n.read_at == null ? <span className="w-2 h-2 rounded-full bg-emerald-400" /> : null}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-1 px-1">
            <button className="text-xs underline opacity-80 hover:opacity-100" onClick={() => { router.push("/notifications"); setOpen(false); }}>
              View all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
