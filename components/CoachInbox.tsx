// components/CoachInbox.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Mail, Send, UserCircle, CheckCircle2, MessageSquare } from "lucide-react";

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

type Thread = {
  athlete: Profile;
  last?: Msg;
  unread: number;
};

export default function CoachInbox() {
  const supabase = useMemo(() => getSupabase(), []);
  const [meId, setMeId] = useState<string | null>(null);
  const [athletes, setAthletes] = useState<Profile[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeAthleteId, setActiveAthleteId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  const msgBoxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const channelRef = useRef<any>(null);

  // Initial load: me + my athletes
  const loadAthletes = useCallback(async () => {
    setLoading(true); setNote("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMeId(user.id);

      const { data: links, error: lerr } = await supabase
        .from("coach_athletes").select("athlete_id").eq("coach_id", user.id);
      if (lerr) throw lerr;
      const ids = (links ?? []).map((r: any) => r.athlete_id);
      if (ids.length === 0) {
        setAthletes([]); setThreads([]); setLoading(false); return;
      }

      const { data: ppl, error: perr } = await supabase
        .from("profiles").select("id, email, display_name").in("id", ids);
      if (perr) throw perr;

      const athleteList = (ppl ?? []) as Profile[];
      setAthletes(athleteList);

      const { data: msgs, error: merr } = await supabase
        .from("messages")
        .select("*")
        .eq("coach_id", user.id)
        .in("athlete_id", ids)
        .order("created_at", { ascending: true });
      if (merr) throw merr;

      const unreadByAthlete: Record<string, number> = {};
      const lastByAthlete: Record<string, Msg> = {};
      (msgs ?? []).forEach((m: any) => {
        if (!m.read_at && m.recipient_id === user.id) {
          unreadByAthlete[m.athlete_id] = (unreadByAthlete[m.athlete_id] || 0) + 1;
        }
        lastByAthlete[m.athlete_id] = m as Msg;
      });

      const built: Thread[] = athleteList.map((a) => ({
        athlete: a,
        last: lastByAthlete[a.id],
        unread: unreadByAthlete[a.id] || 0,
      })).sort((a, b) => {
        const at = a.last?.created_at || "1970-01-01";
        const bt = b.last?.created_at || "1970-01-01";
        return bt.localeCompare(at);
      });

      setThreads(built);
      if (!activeAthleteId && athleteList.length > 0) {
        setActiveAthleteId(athleteList[0].id);
      }
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, activeAthleteId]);

  useEffect(() => { loadAthletes(); }, [loadAthletes]);

  // Load messages for active thread + mark unread as read
  const loadThread = useCallback(async (aid: string | null) => {
    if (!aid || !meId) return;
    try {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("coach_id", meId)
        .eq("athlete_id", aid)
        .order("created_at", { ascending: true });
      const list = (data ?? []) as Msg[];
      setMessages(list);

      // mark unread → read (only those sent TO me)
      const hasUnread = list.some(m => m.recipient_id === meId && !m.read_at);
      if (hasUnread) {
        await supabase
          .from("messages")
          .update({ read_at: new Date().toISOString() })
          .eq("coach_id", meId)
          .eq("athlete_id", aid)
          .eq("recipient_id", meId)
          .is("read_at", null);
      }

      // update thread badge locally
      setThreads(prev => prev.map(t => t.athlete.id === aid ? { ...t, unread: 0 } : t));
    } catch {
      /* ignore */
    }
  }, [supabase, meId]);

  useEffect(() => { loadThread(activeAthleteId); }, [activeAthleteId, loadThread]);

  // Realtime for all my messages
  useEffect(() => {
    if (!meId) return;
    let canceled = false;

    // clean any old channel
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

    const ch = supabase
      .channel(`coach-inbox:${meId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `coach_id=eq.${meId}` },
        () => { if (!canceled) { loadAthletes(); loadThread(activeAthleteId || null); } }
      )
      .subscribe();

    channelRef.current = ch;

    return () => {
      canceled = true;
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
  }, [supabase, meId, loadAthletes, loadThread, activeAthleteId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = msgBoxRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, activeAthleteId]);

  async function send(body: string) {
    const text = body.trim();
    if (!text || !meId || !activeAthleteId) return;
    await supabase.from("messages").insert({
      coach_id: meId,
      athlete_id: activeAthleteId,
      sender_id: meId,
      recipient_id: activeAthleteId,
      body: text
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <Mail className="text-emerald-300" />
        <h3 className="font-semibold">Coach Inbox</h3>
        {loading ? <span className="text-xs ml-2" style={{color:"var(--muted)"}}>Loading…</span> : null}
        {note ? <span className="text-xs ml-auto" style={{color:"#fca5a5"}}>{note}</span> : null}
      </div>

      <div className="mt-3 grid" style={{gridTemplateColumns:"260px 1fr", gap:12, minHeight:360}}>
        {/* Threads list */}
        <div className="rounded border border-white/10">
          <div className="p-2 text-xs" style={{color:"var(--muted)"}}>Athletes</div>
          <div className="divide-y divide-white/10">
            {athletes.length === 0 ? (
              <div className="p-3 text-sm" style={{color:"var(--muted)"}}>No linked athletes yet.</div>
            ) : (
              threads.map(t => {
                const active = t.athlete.id === activeAthleteId;
                const name = t.athlete.display_name || t.athlete.email || "Athlete";
                return (
                  <button
                    key={t.athlete.id}
                    className={`w-full text-left p-3 hover:bg-white/5 ${active ? "bg-white/5" : ""}`}
                    onClick={() => setActiveAthleteId(t.athlete.id)}
                  >
                    <div className="flex items-center gap-2">
                      <UserCircle className="w-5 h-5 text-emerald-300" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{name}</div>
                        <div className="truncate text-xs" style={{color:"var(--muted)"}}>
                          {t.last?.body || "No messages yet"}
                        </div>
                      </div>
                      {t.unread > 0 && (
                        <span className="ml-2 text-xs px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-200">
                          {t.unread}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Thread view */}
        <div className="rounded border border-white/10 flex flex-col">
          {activeAthleteId ? (
            <>
              <div
                ref={msgBoxRef}
                className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[320px]"
              >
                {messages.length === 0 ? (
                  <div className="h-full min-h-[280px] flex items-center justify-center">
                    <div className="max-w-xs w-full text-center p-4 rounded-lg border border-white/10 bg-white/5">
                      <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-70" />
                      <div className="font-medium">Start the conversation</div>
                      <div className="text-xs mt-1" style={{color:"var(--muted)"}}>
                        Your first message will appear here.
                      </div>
                    </div>
                  </div>
                ) : (
                  messages.map(m => {
                    const mine = m.sender_id === meId;
                    return (
                      <div
                        key={m.id}
                        className={`max-w-[68%] md:max-w-[60%] lg:max-w-[48%] break-words ${mine ? "ml-auto" : ""}`}
                      >
                        <div className={`px-3 py-2 rounded ${mine ? "bg-emerald-500/15 border border-emerald-500/30" : "bg-white/5 border border-white/10"}`}>
                          <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                          <div className="mt-1 text-[10px]" style={{color:"var(--muted)"}}>
                            {new Date(m.created_at).toLocaleString()}
                            {mine && m.read_at ? <span className="inline-flex items-center gap-1 ml-2"><CheckCircle2 className="w-3 h-3" /> Read</span> : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-3 border-t border-white/10">
                <form
                  onSubmit={(e) => { e.preventDefault(); send(inputRef.current?.value || ""); }}
                  className="flex items-end gap-2"
                >
                  <textarea ref={inputRef} className="flex-1 field" rows={2} placeholder="Type a message…" />
                  <button className="btn btn-dark inline-flex items-center gap-1" type="submit">
                    <Send className="w-4 h-4" /> Send
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="p-4 text-sm" style={{color:"var(--muted)"}}>Select an athlete to view messages.</div>
          )}
        </div>
      </div>
    </div>
  );
}
