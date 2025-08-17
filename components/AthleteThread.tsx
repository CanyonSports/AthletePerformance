// components/AthleteThread.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as Supa from "@/lib/supabaseClient";
import { Send, AlertCircle } from "lucide-react";

type MessageRow = {
  id: string;
  coach_id: string;
  athlete_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string; // timestamptz
};

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
};

export default function AthleteThread({
  athleteId,
  focusMessageId,
}: {
  athleteId: string;
  focusMessageId?: string;
}) {
  // Supabase accessor (supports either getSupabase() or exported supabase)
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try {
      if (typeof anyS.getSupabase === "function") return anyS.getSupabase();
    } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [meId, setMeId] = useState<string | null>(null);
  const [meProfile, setMeProfile] = useState<Profile | null>(null);
  const [msgs, setMsgs] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string>("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<any>(null);
  const initialFocusedDoneRef = useRef(false);

  const threadKey = `${meId ?? "?"}:${athleteId ?? "?"}`;

  // Load current user + profile
  const loadMe = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setMeId(null); setMeProfile(null); return; }
      setMeId(user.id);
      const prof = await supabase.from("profiles").select("id,email,display_name").eq("id", user.id).maybeSingle();
      if (!prof.error) setMeProfile(prof.data as Profile);
    } catch {
      /* ignore */
    }
  }, [supabase]);

  // Fetch thread messages
  const loadThread = useCallback(async () => {
    if (!supabase || !meId || !athleteId) return;
    setLoading(true);
    setNote("");
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("coach_id", meId)        // this page is the COACH console
        .eq("athlete_id", athleteId) // single thread
        .order("created_at", { ascending: true })
        .limit(1000);
      if (error) throw error;
      setMsgs((data || []) as MessageRow[]);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, meId, athleteId]);

  // Mark my unread messages as read
  const markRead = useCallback(async () => {
    if (!supabase || !meId || msgs.length === 0) return;
    const unreadIds = msgs
      .filter(m => m.recipient_id === meId && !m.read_at)
      .map(m => m.id);
    if (unreadIds.length === 0) return;
    try {
      await supabase
        .from("messages")
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds);
    } catch {
      /* ignore; RLS will enforce anyway */
    }
  }, [supabase, meId, msgs]);

  // Initial load
  useEffect(() => { loadMe(); }, [loadMe]);

  useEffect(() => {
    if (!meId) return;
    loadThread();
  }, [meId, athleteId, loadThread]);

  // Realtime subscribe (robust cleanup)
  useEffect(() => {
    if (!supabase || !meId || !athleteId) return;

    // Remove any existing channel (hot reload / strict mode safety)
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

    let canceled = false;
    const ch = supabase
      .channel(`thread:${meId}:${athleteId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `coach_id=eq.${meId}` },
        (payload: { new: any; record: any; }) => {
          // Filter to our athlete thread only
          const rec = (payload.new || payload.record) as MessageRow | undefined;
          if (!rec || rec.athlete_id !== athleteId) return;
          if (canceled) return;
          // Simple strategy: reload (keeps ordering right & avoids edge-cases)
          loadThread();
        }
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
        } else if (typeof cur.unsubscribe === "function") {
          cur.unsubscribe();
        }
        channelRef.current = null;
      } catch {}
    };
  }, [supabase, meId, athleteId, loadThread]);

  // After messages load/change: mark read & auto-scroll
  useEffect(() => {
    if (!meId) return;

    // Mark unread → read
    markRead();

    // If a focus target is provided, scroll to it once
    if (focusMessageId && !initialFocusedDoneRef.current) {
      const el = document.getElementById(`msg-${focusMessageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-emerald-400");
        setTimeout(() => el.classList.remove("ring-2", "ring-emerald-400"), 1600);
        initialFocusedDoneRef.current = true;
        return;
      }
    }

    // Otherwise scroll to bottom
    const box = listRef.current;
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }, [msgs, meId, focusMessageId, markRead, threadKey]);

  async function send() {
    if (!supabase || !meId || !athleteId) return;
    const text = input.trim();
    if (!text) return;
    setSending(true);
    try {
      // Insert with canonical thread keys (coach_id = meId here; this is the coach console)
      const { error } = await supabase
        .from("messages")
        .insert({
          coach_id: meId,
          athlete_id: athleteId,
          sender_id: meId,
          recipient_id: athleteId,
          body: text,
        } as Partial<MessageRow>);
      if (error) throw error;
      setInput("");
      // Optimistic scroll to bottom; realtime will reload shortly
      const box = listRef.current;
      if (box) setTimeout(() => (box.scrollTop = box.scrollHeight), 10);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  function fmtWhen(ts: string) {
    try { return new Date(ts).toLocaleString(); } catch { return ts; }
  }

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <div className="text-sm font-semibold">Conversation</div>
        <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
          {loading ? "Loading…" : ""}
        </div>
      </div>

      {/* Note / errors */}
      {note ? (
        <div className="px-3 py-2 text-xs flex items-center gap-2" style={{ color: "#fca5a5" }}>
          <AlertCircle className="w-4 h-4" />
          {note}
        </div>
      ) : null}

      {/* Message list */}
      <div ref={listRef} className="p-3 space-y-3 max-h-[50vh] overflow-y-auto">
        {msgs.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            No messages yet. Start the conversation below.
          </div>
        ) : (
          msgs.map((m) => {
            const mine = m.sender_id === meId;
            return (
              <div
                key={m.id}
                id={`msg-${m.id}`}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={[
                    "max-w-[80%] md:max-w-[70%] lg:max-w-[60%] rounded px-3 py-2",
                    mine ? "bg-emerald-600 text-black" : "bg-white/10 text-white",
                    "shadow-sm"
                  ].join(" ")}
                >
                  <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>
                  <div className="mt-1 text-[10px] opacity-70 text-right">{fmtWhen(m.created_at)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="p-2 border-t border-white/10">
        <div className="flex items-end gap-2">
          <textarea
            className="flex-1 field"
            rows={2}
            placeholder="Type a message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!sending) send();
              }
            }}
          />
          <button
            className="btn btn-dark inline-flex items-center gap-2"
            onClick={send}
            disabled={sending || input.trim().length === 0}
            title={sending ? "Sending…" : "Send"}
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </div>
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
        Press <kbd className="px-1 rounded bg-white/10">Enter</kbd> to send • <kbd className="px-1 rounded bg-white/10">Shift</kbd>+<kbd className="px-1 rounded bg-white/10">Enter</kbd> for a new line
      </div>
    </div>
  );
}
