// components/AthleteEnduranceBlock.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";
import { Timer } from "lucide-react";

type Interval = {
  id: string;
  plan_item_id: string;
  block: "warmup" | "main" | "cooldown";
  order_index: number;
  repeats: number;
  mode: "duration" | "distance";
  duration_sec: number | null;
  distance_m: number | null;
  target_type: "rpe" | "pace" | "hr" | "power";
  target_low: number | null;
  target_high: number | null;
  notes: string | null;
};

type Props = {
  planItemId: string;
  userId?: string; // optional; we don't filter by user_id to avoid hiding data
};

function secondsToHMS(s: number | null | undefined) {
  const v = typeof s === "number" ? s : 0;
  if (!v || v <= 0) return "0:00";
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function targetLabel(r: Interval) {
  const lo = r.target_low ?? undefined;
  const hi = r.target_high ?? undefined;
  const dash = lo != null && hi != null && lo !== hi ? `–${hi}` : "";
  switch (r.target_type) {
    case "rpe":   return lo != null ? `RPE ${lo}${dash}` : "RPE";
    case "hr":    return lo != null ? `${lo}${dash} bpm` : "HR";
    case "power": return lo != null ? `${lo}${dash} W` : "Power";
    case "pace":  return lo != null ? `Pace ${lo}${dash}` : "Pace";
    default:      return "";
  }
}

const blockOrder = (blk: Interval["block"]) =>
  blk === "warmup" ? 0 : blk === "main" ? 1 : 2;

export default function AthleteEnduranceBlock({ planItemId }: Props) {
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);
  const isConfigured = Boolean(supabase);

  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Interval[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isConfigured || !supabase || !planItemId) return;
      setLoading(true);
      setNote("");
      try {
        const { data, error } = await supabase
          .from("training_intervals")
          .select("id,plan_item_id,block,order_index,repeats,mode,duration_sec,distance_m,target_type,target_low,target_high,notes")
          .eq("plan_item_id", planItemId);

        if (error) throw error;

        const list = (data ?? []) as Interval[];
        // Sort client-side to guarantee Warm-up → Main → Cool-down, then by order_index
        list.sort((a, b) => {
          const bo = blockOrder(a.block) - blockOrder(b.block);
          if (bo !== 0) return bo;
          return (a.order_index ?? 0) - (b.order_index ?? 0);
        });

        if (!cancelled) setRows(list);
      } catch (e: any) {
        if (!cancelled) setNote(e.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [isConfigured, supabase, planItemId]);

  // Group by block for nicer UI
  const warmup = rows.filter(r => r.block === "warmup");
  const main   = rows.filter(r => r.block === "main");
  const cool   = rows.filter(r => r.block === "cooldown");

  function Block({ title, list }: { title: string; list: Interval[] }) {
    if (list.length === 0) return null;

    return (
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="flex items-center gap-2">
          <div className="font-semibold">{title}</div>
          <div className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
            {list.length} row{list.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {list.map((r, i) => {
            const mainText =
              r.mode === "duration"
                ? `${r.repeats}× ${secondsToHMS(r.duration_sec)}`
                : `${r.repeats}× ${(Number(r.distance_m ?? 0) / 1000).toFixed(2)} km`;
            return (
              <div key={r.id || i} className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{mainText}</div>
                  <div className="text-xs opacity-80"> @ {targetLabel(r)}</div>
                  <div className="ml-auto text-xs opacity-70 inline-flex items-center gap-1">
                    <Timer className="w-3 h-3" />
                    {r.mode === "duration" ? secondsToHMS((r.duration_sec ?? 0) * r.repeats) : "—"}
                  </div>
                </div>
                {r.notes ? <div className="mt-2 text-xs opacity-80">{r.notes}</div> : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="rounded-xl bg-white/5 p-3">Loading endurance…</div>
      ) : note ? (
        <div className="rounded-xl bg-white/5 p-3 text-sm" style={{ color: "#fca5a5" }}>{note}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-white/5 p-3 text-sm opacity-80">
          No endurance intervals were assigned for this session.
        </div>
      ) : (
        <>
          <Block title="Warm-up" list={warmup} />
          <Block title="Main Set" list={main} />
          <Block title="Cool-down" list={cool} />
        </>
      )}
    </div>
  );
}
